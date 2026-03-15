const lightLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
});

const darkLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20
});

const map = L.map("map", {
    zoomControl: false,
    layers: [lightLayer]
}).setView([20, 0], 2);

L.control.zoom({ position: 'bottomright' }).addTo(map);

let routingControl = null;
let currentVehicleData = null;

function toggleMapTheme() {
    const toggle = document.getElementById("theme-toggle");
    if (toggle.checked) {
        map.removeLayer(lightLayer);
        darkLayer.addTo(map);
    } else {
        map.removeLayer(darkLayer);
        lightLayer.addTo(map);
    }
}

function debounce(func, timeout = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

async function getSuggestions(query, containerId, apiType = 'location') {
  const container = document.getElementById(containerId);
  const category = document.getElementById("travel-mode").value;
  
  if (!query || (apiType === 'location' && query.length < 3) || (apiType === 'vehicle' && query.length < 2)) {
    container.style.display = "none";
    return;
  }

  try {
    let url;
    if (apiType === 'location') {
        url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
    } else {
        url = `/api/vehicle-suggestions?q=${encodeURIComponent(query)}&category=${category}`;
    }

    const response = await fetch(url);
    const data = await response.json();
    container.innerHTML = "";
    
    const items = apiType === 'location' 
        ? (data.features || []).map(f => [f.properties.name, f.properties.city, f.properties.country].filter(v => v).join(", "))
        : data;

    if (items.length > 0) {
      items.forEach((itemText) => {
        const div = document.createElement("div");
        div.className = "suggestion-item-v2";
        div.innerText = itemText;
        
        div.onmousedown = (e) => {
          e.preventDefault();
          const inputId = containerId.replace("-suggestions", "-point").replace("vehicle-suggestions", "vehicle-model");
          document.getElementById(inputId).value = itemText;
          container.style.display = "none";
          if (apiType === 'vehicle') fetchVehicleInfo(itemText);
        };
        
        container.appendChild(div);
      });
      container.style.display = "block";
    } else {
      container.style.display = "none";
    }
  } catch (error) { console.error(error); }
}

// Input Listeners
document.getElementById("start-point").addEventListener("input", debounce((e) => getSuggestions(e.target.value, "start-suggestions", 'location')));
document.getElementById("end-point").addEventListener("input", debounce((e) => getSuggestions(e.target.value, "end-suggestions", 'location')));
document.getElementById("vehicle-model").addEventListener("input", debounce((e) => getSuggestions(e.target.value, "vehicle-suggestions", 'vehicle')));

// Suggestions blur handler
["start-point", "end-point", "vehicle-model"].forEach(id => {
    document.getElementById(id).addEventListener("blur", () => {
        setTimeout(() => {
            const sugId = id.includes("vehicle") ? "vehicle-suggestions" : id.replace("-point", "-suggestions");
            const el = document.getElementById(sugId);
            if (el) el.style.display = "none";
        }, 200);
    });
});

async function fetchVehicleInfo(overrideModel = null) {
    const model = overrideModel || document.getElementById("vehicle-model").value;
    const category = document.getElementById("travel-mode").value;
    if (!model) return;

    try {
        const response = await fetch(`/api/vehicle-info?model=${encodeURIComponent(model)}&category=${category}`);
        const data = await response.json();
        currentVehicleData = data;

        document.getElementById("stat-mileage").innerText = `${data.mileage} km/L`;
        document.getElementById("stat-fuel").innerText = data.fuel_type;
        document.getElementById("stat-engine").innerText = data.engine;
        document.getElementById("stat-price").innerText = `₹${data.fuel_price}/L`;
        
        document.getElementById("vehicle-stats-card").classList.remove("hidden");
        document.getElementById("status-model").innerText = data.model;
        document.getElementById("vehicle-status").classList.remove("opacity-0");

        if (routingControl && routingControl._selectedRoute) {
            updateTripAnalytics(routingControl._selectedRoute);
        }
    } catch (error) { console.error(error); }
}

function updateTripAnalytics(route) {
    if (!route) return;
    const summary = route.summary;
    const distKm = summary.totalDistance / 1000;
    const timeHrs = Math.floor(summary.totalTime / 3600);
    const timeMins = Math.round((summary.totalTime % 3600) / 60);

    const mileage = currentVehicleData ? currentVehicleData.mileage : 18.0;
    const fuelPrice = currentVehicleData ? currentVehicleData.fuel_price : 103.44;
    const cost = (distKm / mileage) * fuelPrice;

    document.getElementById("display-distance").innerText = `${distKm.toFixed(1)} km`;
    document.getElementById("display-time").innerText = `${timeHrs}h ${timeMins}m`;
    document.getElementById("display-cost").innerText = `₹${cost.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById("display-mileage").innerText = mileage;
    document.getElementById("display-fuel-type").innerText = currentVehicleData ? currentVehicleData.fuel_type : "Petrol";
    document.getElementById("trip-analytics").classList.remove("hidden");
}

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
  const response = await fetch(url);
  const data = await response.json();
  return data.length > 0 ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
}

async function findRoute() {
  const startAddr = document.getElementById("start-point").value;
  const endAddr = document.getElementById("end-point").value;
  const btn = document.getElementById("search-btn");

  if (!startAddr || !endAddr) {
    alert("Please enter origin and destination.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Optimizing...</span>`;

  if (routingControl) map.removeControl(routingControl);

  try {
    const start = await geocode(startAddr);
    const end = await geocode(endAddr);
    await fetchVehicleInfo();

    if (!start || !end) {
      alert("Locations not found.");
      resetButton();
      return;
    }

    routingControl = L.Routing.control({
      waypoints: [L.latLng(start.lat, start.lon), L.latLng(end.lat, end.lon)],
      routeWhileDragging: false,
      lineOptions: { styles: [{ color: "#0284c7", opacity: 0.8, weight: 6 }] },
    }).addTo(map);

    const directionsPanel = document.getElementById("directions-panel");
    directionsPanel.innerHTML = "";
    directionsPanel.appendChild(routingControl.getContainer());

    routingControl.on("routesfound", function (e) {
      routingControl._selectedRoute = e.routes[0];
      updateTripAnalytics(e.routes[0]);
      resetButton();
    });
  } catch (error) {
    console.error(error);
    resetButton();
  }
}

function resetButton() {
    const btn = document.getElementById("search-btn");
    btn.disabled = false;
    btn.innerHTML = `<span>Analyze & Plan Trip</span><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>`;
}
