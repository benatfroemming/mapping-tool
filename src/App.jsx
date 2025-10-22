import React, { useState, useRef, useEffect } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import protomap from "./assets/protomap.json";
import Plot from "react-plotly.js";
import { ReactSortable } from "react-sortablejs";
import * as turf from "@turf/turf";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faPlus, faFlask, faGripVertical } from "@fortawesome/free-solid-svg-icons";

import metroRoutes from "./assets/Metro_Bus_Routes.json";
import dcBoundary from "./assets/State_of_Washington_DC_2021.json";
import crime2024 from "./assets/Crime_Incidents_in_2024.json";

export default function GeoStack() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [geojsonLayers, setGeojsonLayers] = useState([]);
  const [filteredLayers, setFilteredLayers] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);

  // Initialize map
  useEffect(() => {
    if (map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: protomap,
      center: [0, 0],
      zoom: 2,
    });

    map.current.on("load", () => setMapLoaded(true));
  }, []);

  // Add new layer
  const addLayerFromGeoJSON = (geojson, name = "Untitled.geojson") => {
    const layerId = `${name.replace(/\W/g, "_")}_${Date.now()}`;
    const props = geojson.features?.[0]?.properties || {};
    const propKeys = Object.keys(props);

    const newLayer = {
      id: layerId,
      name,
      geojson,
      properties: propKeys,
      selectedProp: "",
      colorMap: {},
      sourceId: `source-${layerId}`,
      fillLayerId: `fill-${layerId}`,
      lineLayerId: `line-${layerId}`,
      pointLayerId: `point-${layerId}`,
    };

    setGeojsonLayers(prev => [...prev, newLayer]);
    return newLayer; 
  };


  // Remove layer
  const removeLayer = (layerId) => {
    if (!map.current) return;
    const layer = geojsonLayers.find((l) => l.id === layerId);
    if (layer) {
      [layer.fillLayerId, layer.lineLayerId, layer.pointLayerId].forEach((id) => {
        if (map.current.getLayer(id)) map.current.removeLayer(id);
      });
      if (map.current.getSource(layer.sourceId)) map.current.removeSource(layer.sourceId);
    }
    setGeojsonLayers((prev) => prev.filter((l) => l.id !== layerId));
    if (selectedLayerId === layerId) setSelectedLayerId(null);
  };

  // Use sample layers
  const useSample = () => {
    const l1 = addLayerFromGeoJSON(metroRoutes, "Metro Bus Routes");
    const l2 = addLayerFromGeoJSON(dcBoundary, "Washington DC State Boundary");
    const l3 = addLayerFromGeoJSON(crime2024, "Crime Incidents 2024");

    // Call sort after adding
    handleSort([l1, l2, l3]); 
  };



  // Add/update layers on map
  useEffect(() => {
    if (!mapLoaded) return;

    geojsonLayers.forEach((layer) => {
      const { sourceId, fillLayerId, lineLayerId, pointLayerId, geojson } = layer;

      if (!map.current.getSource(sourceId)) {
        map.current.addSource(sourceId, { type: "geojson", data: geojson });

        // Polygon
        map.current.addLayer({
          id: fillLayerId,
          type: "fill",
          source: sourceId,
          paint: { "fill-color": "#33a02c", "fill-opacity": 0.5, "fill-outline-color": "#000" },
          filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
        });

        // Line
        map.current.addLayer({
          id: lineLayerId,
          type: "line",
          source: sourceId,
          paint: { "line-color": "#ffcc00", "line-width": 2 },
          filter: ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "MultiLineString"]],
        });

        // Point
        map.current.addLayer({
          id: pointLayerId,
          type: "circle",
          source: sourceId,
          paint: { "circle-radius": 6, "circle-color": "#e31a1c", "circle-stroke-width": 1, "circle-stroke-color": "#fff" },
          filter: ["==", ["geometry-type"], "Point"],
        });
      } else {
        map.current.getSource(sourceId).setData(geojson);
      }
    });

    setFilteredLayers(geojsonLayers);
    if (!selectedLayerId && geojsonLayers.length) setSelectedLayerId(geojsonLayers[0].id);
  }, [geojsonLayers, mapLoaded]);

  // Layer sorting: top sidebar = top map layer
  const handleSort = (newList) => {
    setGeojsonLayers(newList);
    if (!map.current) return;

    let topLayerId; // will track the topmost layer in map
    for (let i = 0; i < newList.length; i++) {
      const layer = newList[i];
      [layer.fillLayerId, layer.lineLayerId, layer.pointLayerId].forEach((id) => {
        if (map.current.getLayer(id)) {
          map.current.moveLayer(id, topLayerId); 
        }
      });
      topLayerId = layer.fillLayerId; 
    }
  };



  // Fly to selected layer
  useEffect(() => {
    if (!selectedLayerId || !map.current) return;
    const layer = geojsonLayers.find((l) => l.id === selectedLayerId);
    if (!layer || !layer.geojson.features.length) return;

    const bbox = turf.bbox(layer.geojson);
    map.current.fitBounds(bbox, { padding: 50, maxZoom: 14, duration: 1000 });
  }, [selectedLayerId]);

  const selectedLayer = filteredLayers.find((l) => l.id === selectedLayerId);

  // Calculate stats
  const calculateStats = (geojson) => {
    const f = geojson.features || [];
    return {
      Points: f.filter((x) => x.geometry.type === "Point").length,
      Lines: f.filter((x) => x.geometry.type.includes("Line")).length,
      Polygons: f.filter((x) => x.geometry.type.includes("Polygon")).length,
      Total: f.length,
    };
  };

  // Update layer style by property
  const updateLayerStyle = (layer) => {
    const { selectedProp, geojson, fillLayerId, lineLayerId, pointLayerId } = layer;
    if (!selectedProp || !map.current) return;

    const values = geojson.features.map((f) => f.properties?.[selectedProp]).filter(Boolean);
    const isNumeric = values.every((v) => !isNaN(parseFloat(v)));
    let fillColor, circleColor, lineColor, colorMap = {};

    if (isNumeric) {
      const nums = values.map(Number);
      const min = Math.min(...nums), max = Math.max(...nums);
      fillColor = circleColor = lineColor = ["interpolate", ["linear"], ["to-number", ["get", selectedProp]], min, "#2c7bb6", (min + max) / 2, "#abd9e9", max, "#d7191c"];
    } else {
      const cats = [...new Set(values)];
      const palette = ["#1f78b4", "#33a02c", "#e31a1c", "#ff7f00", "#6a3d9a"];
      fillColor = ["match", ["get", selectedProp], ...cats.flatMap((c, i) => { colorMap[c] = palette[i % palette.length]; return [c, palette[i % palette.length]]; }), "#ccc"];
      circleColor = lineColor = fillColor;
    }

    map.current.setPaintProperty(fillLayerId, "fill-color", fillColor);
    map.current.setPaintProperty(pointLayerId, "circle-color", circleColor);
    map.current.setPaintProperty(lineLayerId, "line-color", lineColor);

    setGeojsonLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, colorMap } : l)));
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#121212", color: "#fff" }}>
      {/* Header */}
      <header style={{ background: "#1e1e1e", padding: "10px 20px", borderBottom: "1px solid #333", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>GeoStack</h2>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <label style={{ cursor: "pointer", background: "#333", padding: "6px 10px", borderRadius: 6 }}>
            <FontAwesomeIcon icon={faPlus} /> Add Layer
            <input type="file" multiple accept=".geojson,.json" onChange={(e) => { Array.from(e.target.files).forEach(f => { const r = new FileReader(); r.onload = (ev) => { try { addLayerFromGeoJSON(JSON.parse(ev.target.result), f.name); } catch { alert(`Invalid GeoJSON: ${f.name}`); } }; r.readAsText(f); }); }} style={{ display: "none" }} />
          </label>
          <button onClick={useSample} style={{ background: "#333", color: "#fff", padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer" }}>
            <FontAwesomeIcon icon={faFlask} /> Use Sample
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1 }}>
        {/* Map */}
        <div ref={mapContainer} style={{ flex: 1, borderRight: "2px solid #333" }} />

        {/* Sidebar */}
        <div style={{ width: "40%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Layers list */}
          <div style={{ flexShrink: 0, padding: 10, maxHeight: 200, overflowY: "auto", borderBottom: "1px solid #333" }}>
            <h4>Layers</h4>
            <ReactSortable list={filteredLayers} setList={handleSort}>
              {filteredLayers.map((layer) => (
                <div key={layer.id} onClick={() => setSelectedLayerId(layer.id)} style={{ padding: 8, marginBottom: 5, background: selectedLayerId === layer.id ? "#444" : "#222", borderRadius: 5, cursor: "grab", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <FontAwesomeIcon icon={faGripVertical} />
                    <span>{layer.name}</span>
                  </div>
                  <FontAwesomeIcon icon={faXmark} onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }} style={{ cursor: "pointer" }} />
                </div>
              ))}
            </ReactSortable>
          </div>

          {/* Plot area */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {!selectedLayer && <p style={{ color: "#aaa" }}>Select a layer to view its stats or plot.</p>}
            {selectedLayer && (
              <>
                {selectedLayer.properties.length === 0 || !selectedLayer.selectedProp ? (
                  <div>
                    <h4>Stats</h4>
                    <ul>{Object.entries(calculateStats(selectedLayer.geojson)).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
                  </div>
                ) : (
                  <div style={{ width: "100%", height: 340 }}>
                    <Plot
                      data={(function () {
                        const vals = selectedLayer.geojson.features.map(f => f.properties?.[selectedLayer.selectedProp]).filter(Boolean);
                        const isNum = vals.every(v => !isNaN(parseFloat(v)));
                        if (isNum) return [{ type: "box", y: vals.map(Number), name: selectedLayer.selectedProp, marker: { color: "#1f77b4" } }];
                        const counts = vals.reduce((a, c) => { a[c] = (a[c] || 0) + 1; return a; }, {});
                        return [{ type: "bar", x: Object.keys(counts), y: Object.values(counts), marker: { color: Object.keys(counts).map(c => selectedLayer.colorMap?.[c] || "#1f77b4") } }];
                      })()}
                      layout={{ autosize: true, paper_bgcolor: "#222", plot_bgcolor: "#222", font: { color: "#fff" }, margin: { l: 50, r: 20, t: 40, b: 50 }, title: `Plot of ${selectedLayer.selectedProp || "Stats"}` }}
                      useResizeHandler
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>
                )}

                {selectedLayer.properties.length > 0 && (
                  <div style={{ marginTop: 15 }}>
                    <label>Property:</label>
                    <select
                      value={selectedLayer.selectedProp}
                      onChange={(e) => {
                        const prop = e.target.value;
                        const updated = { ...selectedLayer, selectedProp: prop };
                        setGeojsonLayers(prev => prev.map(l => (l.id === selectedLayer.id ? updated : l)));
                        updateLayerStyle(updated);
                      }}
                      style={{ marginLeft: 10, background: "#333", color: "#fff", border: "1px solid #555", padding: "4px 8px", borderRadius: 5 }}
                    >
                      <option value="">-- Select --</option>
                      {selectedLayer.properties.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}








