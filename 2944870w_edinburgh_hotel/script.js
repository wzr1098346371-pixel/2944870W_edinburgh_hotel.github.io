window.addEventListener("DOMContentLoaded", () => {
  mapboxgl.accessToken =
    "pk.eyJ1IjoiMjk0NDg3MHciLCJhIjoiY21rY251N2FpMDJ3dTNrc2N2dGV2MmJ4ZiJ9.k7Y78Zo5d13WxwxqFB-aKQ";

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/2944870w/cmllj66by007501sk15cd2gsm",
    center: [-3.189, 55.9521],
    zoom: 12
  });

  /* ---------- constants ---------- */
  const LAYER_ID = "edinburgh-hotel";
  const FIXED_RADIUS_M = 500;

  // A bbox that covers Edinburgh (west,south,east,north)
  const CITY_BBOX = [-3.45, 55.86, -3.05, 56.02];

  const CIRCLE_SOURCE_ID = "dest-circle";
  const CIRCLE_FILL_LAYER_ID = "dest-circle-fill";
  const CIRCLE_LINE_LAYER_ID = "dest-circle-line";

  /* ---------- DOM ---------- */
  const resultCountEl = document.querySelector(".result-count");
  const downloadBtn = document.querySelector(".download-btn");

  const typeBtn = document.querySelector(".type-btn");
  const typePanel = document.querySelector(".type-panel");

  const destBtn = document.querySelector(".dest-btn");
  const destPanel = document.querySelector(".dest-panel");
  const destSelect = document.querySelector(".dest-select");

  let selectedType = "all";
  let selectedPoi = null;

  // NEW: cache of ALL hotels in Edinburgh bbox
  let allHotels = [];
  let layerSourceId = null;
  let layerSourceLayer = null;

  /* ---------- controls ---------- */
  map.addControl(
    new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl,
      marker: false,
      placeholder: "Search for places in Edinburgh",
      proximity: { longitude: -3.189, latitude: 55.9521 }
    }),
    "top-right"
  );
  map.addControl(new mapboxgl.NavigationControl(), "top-right");
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 140, unit: "metric" }), "bottom-right");

 /* ---------- popup on click (RESTORED) ---------- */
  map.on("click", (event) => {
    // Only respond when clicking a hotel feature
    const features = map.queryRenderedFeatures(event.point, { layers: [LAYER_ID] });
    if (!features.length) return;

    const feature = features[0];

    const addressParts = [
      feature.properties?.["addr:housenumber"],
      feature.properties?.["addr:street"],
      feature.properties?.["addr:city"]
    ].filter(Boolean);

    const address = addressParts.join(", ");

    const website = feature.properties?.website;
    const websiteHtml = website
      ? `<p>Website: <a href="${website}" target="_blank" rel="noopener noreferrer">${website}</a></p>`
      : "";

    const html = [
      `<h3>Hotel Name: ${feature.properties?.name ?? "Unknown"}</h3>`,
      feature.properties?.tourism ? `<p>Type: ${feature.properties.tourism}</p>` : "",
      address ? `<p>Address: ${address}</p>` : "",
      feature.properties?.["addr:postcode"] ? `<p>Postcode: ${feature.properties["addr:postcode"]}</p>` : "",
      feature.properties?.phone ? `<p>Phone: ${feature.properties.phone}</p>` : "",
      websiteHtml
    ].filter(Boolean).join("");

    new mapboxgl.Popup({ offset: [0, 15], className: "my-popup" })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(html)
      .addTo(map);
  });

  // Optional: show pointer cursor when hovering hotels
  map.on("mousemove", (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
    map.getCanvas().style.cursor = f.length ? "pointer" : "";
  });
  
  /* ---------- helpers ---------- */
  function parseLngLat(value) {
    if (!value || value === "none") return null;
    const parts = value.split(",").map((v) => Number(v.trim()));
    if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
    return [parts[0], parts[1]];
  }
  

  function buildTypeFilter() {
    if (selectedType === "all") return true;
    return ["==", ["get", "tourism"], selectedType];
  }

  function buildWithinFilter() {
    if (!selectedPoi) return true;
    const circle = turf.circle(selectedPoi, FIXED_RADIUS_M / 1000, {
      steps: 64,
      units: "kilometers"
    });
    return ["within", circle.geometry];
  }

  function applyCombinedFilter() {
    if (!map.getLayer(LAYER_ID)) return;
    map.setFilter(LAYER_ID, ["all", buildTypeFilter(), buildWithinFilter()]);
    updateResultCount(); // NEW: always update count from cache
  }

  /* ---------- destination circle ---------- */
  function setDestinationCircle(lngLat) {
    const src = map.getSource(CIRCLE_SOURCE_ID);
    if (!src) return;

    if (!lngLat) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const circle = turf.circle(lngLat, FIXED_RADIUS_M / 1000, {
      steps: 96,
      units: "kilometers"
    });

    src.setData(circle);
  }

  /* ---------- panel helpers ---------- */
  function setBtnText(btn, panel, baseText) {
    if (!btn || !panel) return;
    btn.textContent = panel.classList.contains("is-hidden")
      ? `${baseText} ▾`
      : `${baseText} ▴`;
  }

  function closePanel(btn, panel, baseText) {
    if (!btn || !panel) return;
    panel.classList.add("is-hidden");
    setBtnText(btn, panel, baseText);
  }

  function togglePanel(btn, panel, baseText) {
    if (!btn || !panel) return;
    panel.classList.toggle("is-hidden");
    setBtnText(btn, panel, baseText);
  }

  function closeAllPanels() {
    closePanel(typeBtn, typePanel, "Filter by hotel type");
    closePanel(destBtn, destPanel, "Filter by destination");
  }

  /* ---------- NEW: count based on cached full set ---------- */
  function featurePassesFilters(f) {
    // Type filter
    if (selectedType !== "all") {
      const t = f.properties?.tourism;
      if (t !== selectedType) return false;
    }

    // Destination radius filter
    if (selectedPoi) {
      const coords = f.geometry?.coordinates;
      if (!coords) return false;

      const dKm = turf.distance(
        turf.point(selectedPoi),
        turf.point(coords),
        { units: "kilometers" }
      );

      if (dKm > FIXED_RADIUS_M / 1000) return false;
    }

    return true;
  }

  function updateResultCount() {
    if (!resultCountEl) return;

    // If cache not ready yet, show a friendly fallback
    if (!allHotels.length) {
      resultCountEl.textContent = "Hotels shown: …";
      return;
    }

    const count = allHotels.reduce((acc, f) => acc + (featurePassesFilters(f) ? 1 : 0), 0);
    resultCountEl.textContent = `Hotels shown: ${count}`;
  }

  /* ---------- NEW: cache all hotels in bbox ---------- */
  function dedupeFeatures(feats) {
    const seen = new Set();
    const out = [];

    for (const f of feats) {
      const key =
        f.id ??
        f.properties?.["@id"] ??
        f.properties?.osm_id ??
        `${f.geometry?.coordinates?.[0]}_${f.geometry?.coordinates?.[1]}_${f.properties?.name ?? ""}`;

      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }

  function cacheAllHotelsInBbox() {
    if (!layerSourceId) return;

    // Temporarily zoom/fit to bbox to force tiles to load, then querySourceFeatures.
    const prev = { center: map.getCenter(), zoom: map.getZoom() };

    map.fitBounds(CITY_BBOX, { padding: 20, duration: 0 });

    map.once("idle", () => {
      let feats = [];
      if (layerSourceLayer) {
        feats = map.querySourceFeatures(layerSourceId, { sourceLayer: layerSourceLayer }) || [];
      } else {
        feats = map.querySourceFeatures(layerSourceId) || [];
      }

      allHotels = dedupeFeatures(feats);

      // Restore view
      map.jumpTo({ center: prev.center, zoom: prev.zoom });

      // Update count using cache
      updateResultCount();
    });
  }

  /* ---------- UI events ---------- */
  if (typeBtn && typePanel) {
    setBtnText(typeBtn, typePanel, "Filter by hotel type");

    typeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel(destBtn, destPanel, "Filter by destination");
      togglePanel(typeBtn, typePanel, "Filter by hotel type");
    });

    typePanel.addEventListener("click", (e) => e.stopPropagation());

    typePanel.addEventListener("change", (e) => {
      if (e.target && e.target.name === "hotelType") {
        selectedType = e.target.value;
        applyCombinedFilter();
      }
    });
  }

  if (destBtn && destPanel) {
    setBtnText(destBtn, destPanel, "Filter by destination");

    destBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel(typeBtn, typePanel, "Filter by hotel type");
      togglePanel(destBtn, destPanel, "Filter by destination");
    });

    destPanel.addEventListener("click", (e) => e.stopPropagation());
  }

  document.addEventListener("click", () => closeAllPanels());

  if (destSelect) {
    destSelect.addEventListener("change", () => {
      selectedPoi = parseLngLat(destSelect.value);

      setDestinationCircle(selectedPoi);
      applyCombinedFilter();

      if (selectedPoi) {
        map.flyTo({
          center: selectedPoi,
          zoom: 15.5,
          speed: 0.9,
          curve: 1.2,
          essential: true
        });
      } else {
        map.flyTo({
          center: [-3.189, 55.9521],
          zoom: 12,
          speed: 0.9,
          curve: 1.2,
          essential: true
        });
      }
    });
  }

  /* ---------- download: use cached filtered results ---------- */
  function downloadGeoJSON(filename, geojsonObj) {
    const blob = new Blob([JSON.stringify(geojsonObj, null, 2)], {
      type: "application/geo+json"
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      if (!allHotels.length) return;

      const filtered = allHotels.filter(featurePassesFilters);
      const fc = {
        type: "FeatureCollection",
        features: filtered.map((f) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: f.properties || {}
        }))
      };
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadGeoJSON(`edinburgh-hotels-filtered-${dateStr}.geojson`, fc);
    });
  }

  /* ---------- load ---------- */
  map.on("load", () => {
    if (!map.getLayer(LAYER_ID)) {
      console.warn("Layer not found:", LAYER_ID);
      return;
    }

    // Get source info from the layer (for querySourceFeatures)
    const lyr = map.getLayer(LAYER_ID);
    layerSourceId = lyr.source;
    layerSourceLayer = lyr["source-layer"] || null;

    // Circle source/layers
    if (!map.getSource(CIRCLE_SOURCE_ID)) {
      map.addSource(CIRCLE_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
    }

    if (!map.getLayer(CIRCLE_FILL_LAYER_ID)) {
      map.addLayer(
        {
          id: CIRCLE_FILL_LAYER_ID,
          type: "fill",
          source: CIRCLE_SOURCE_ID,
          paint: { "fill-color": "#00bcd4", "fill-opacity": 0.18 }
        },
        LAYER_ID
      );
    }

    if (!map.getLayer(CIRCLE_LINE_LAYER_ID)) {
      map.addLayer(
        {
          id: CIRCLE_LINE_LAYER_ID,
          type: "line",
          source: CIRCLE_SOURCE_ID,
          paint: { "line-color": "#00bcd4", "line-width": 2.5 }
        },
        LAYER_ID
      );
    }

    selectedPoi = destSelect ? parseLngLat(destSelect.value) : null;
    setDestinationCircle(selectedPoi);

    // Apply map filter (visual)
    applyCombinedFilter();

    // NEW: build global cache once, then counts no longer depend on zoom
    cacheAllHotelsInBbox();
  });
});