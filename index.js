// Mothitor antenna data vis tab options:
const SEASONS = {
    spring: ["Apr", "May"],
    summer: ["Jun", "Jul", "Aug"],
    fall:   ["Sep", "Oct"]
};

const ALL_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const DEPLOYMENTS = ["SYD", "AMA", "CAR"];

let state = {
    displayMode: "species",          
    activeMonths: new Set(ALL_MONTHS),
    highlightedGroup: null           
};

// color codes for species groups
const COLOR_PALETTE = [
    "#6baed6","#2ca25f","#756bb1","#fd8d3c","#e377c2","#17becf",
    "#bcbd22","#9467bd","#8c564b","#e7ba52","#cedb9c","#9edae5",
    "#637939","#843c39","#5254a3","#6b6ecf","#b5cf6b","#d6616b",
    "#ce6dbd","#de9ed6","#3182bd","#31a354","#e6550d","#756bb1",
    "#636363","#a1d99b","#fdae6b","#9ecae1","#bcbddc","#bdbdbd"
];

let colorMap = {};  

function getColor(name) {
    if (!colorMap[name]) {
        const idx = Object.keys(colorMap).length % COLOR_PALETTE.length;
        colorMap[name] = COLOR_PALETTE[idx];
    }
    return colorMap[name];
}

// loading data
d3.json("mothitor_antenna_data_2025.json").then(rawData => {

    // summing by species/genus/family, group by month and deployment for display
    const aggMap = new Map();

    rawData.forEach(item => {
        if (item.determination.name === "Not Lepidoptera") return;

        const taxon   = item.determination_details.taxon;
        const parents = Object.fromEntries(
            (taxon.parents || []).map(p => [p.rank, p.name])
        );
        const genus   = parents["GENUS"]  || (taxon.rank === "GENUS"  ? taxon.name : "Unknown");
        const family  = parents["FAMILY"] || (taxon.rank === "FAMILY" ? taxon.name : "Unknown");
        const species = taxon.name;
        const month   = item.event.date_label.split(" ")[0];
        const dep     = item.deployment.name;
        const count   = item.detections_count || 1;

        const key = `${dep}|${month}|${species}`;
        if (!aggMap.has(key)) {
            aggMap.set(key, { dep, month, species, genus, family, count: 0 });
        }
        aggMap.get(key).count += count;
    });

    const allRecords = Array.from(aggMap.values());

    // setting colors for species
    const allSpecies = [...new Set(allRecords.map(d => d.species))].sort();
    allSpecies.forEach(s => getColor(s));

    renderBoards(allRecords);
    renderLegend(allRecords);
    setupControls(allRecords);

    d3.select("body").append("div").attr("id", "tooltip");

}).catch(err => {
    document.body.innerHTML += `<p style="color:red">Error loading data: ${err}</p>`;
});

// creating boards for vis
function renderBoards(allRecords) {
    const container = d3.select("#boards");
    container.selectAll(".board-card").remove();

    DEPLOYMENTS.forEach(dep => {
        const card = container.append("div")
            .attr("class", "board-card")
            .attr("id", `board-${dep}`);

        card.append("div").attr("class", "board-title").text(`Mothitor — ${dep}`);
        card.append("div").attr("class", "board-subtitle").text("Avg detections / taxon  ·  click dot for name");
        card.append("div").attr("class", "board-svg-container").attr("id", `svg-container-${dep}`);
    });

    updateBoards(allRecords);
}

function updateBoards(allRecords) {
    DEPLOYMENTS.forEach(dep => {
        drawBoard(dep, allRecords);
    });
}

function drawBoard(dep, allRecords) {
    const container = d3.select(`#svg-container-${dep}`);
    container.selectAll("*").remove();

    const records = allRecords.filter(d =>
        d.dep === dep && state.activeMonths.has(d.month)
    );

    const groupKey = d => d[state.displayMode];

    const groupMap = d3.rollup(records, v => d3.mean(v, d => d.count), groupKey);
    const groups = Array.from(groupMap, ([name, avg]) => ({ name, avg }))
                        .sort((a, b) => b.avg - a.avg);

    if (groups.length === 0) {
        container.append("p").style("color", "#aaa").style("font-size", "0.8rem")
            .text("No data for selected filters.");
        return;
    }


// box dimensions
    const W = 340, H = 320;
    const margin = { top: 16, right: 20, bottom: 40, left: 56 };
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // scalles
    const maxAvg = d3.max(groups, d => d.avg);
    const yScale = d3.scaleLinear()
        .domain([0, maxAvg * 1.1])
        .range([innerH, 0])
        .nice();
    const xScale = d3.scaleBand()
        .domain(groups.map(d => d.name))
        .range([0, innerW])
        .padding(0.5);

    // y
    g.append("g")
        .attr("class", "axis")
        .call(d3.axisLeft(yScale).ticks(5).tickSize(-innerW))
        .call(ax => ax.select(".domain").remove())
        .call(ax => ax.selectAll(".tick line").attr("stroke", "#eee"));

    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -margin.left + 10)
        .attr("x", -innerH / 2)
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("fill", "#888")
        .text("Avg detections / taxon");

    // Dots
    const tooltip = d3.select("#tooltip");

    g.selectAll(".dot")
        .data(groups)
        .join("circle")
        .attr("class", "dot")
        .attr("cx", d => xScale(d.name) + xScale.bandwidth() / 2)
        .attr("cy", d => yScale(d.avg))
        .attr("r", d => Math.max(4, Math.min(14, 4 + d.avg * 0.8)))
        .attr("fill", d => getGroupColor(d.name))
        .attr("opacity", d => dotOpacity(d.name))
        .on("mousemove", (event, d) => {
            tooltip
                .style("display", "block")
                .style("left", (event.clientX + 14) + "px")
                .style("top",  (event.clientY - 28) + "px")
                .html(`<strong>${d.name}</strong><br>Avg detections: ${d.avg.toFixed(1)}`);
        })
        .on("mouseleave", () => {
            tooltip.style("display", "none");
        });

    // x labels
    g.append("text")
        .attr("x", innerW / 2)
        .attr("y", innerH + 30)
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("fill", "#999")
        .text(`${groups.length} taxa shown`);
}
// color assignment for groups (species/genus/family)
const groupColorCache = {};

function getGroupColor(name) {
    if (!groupColorCache[name]) {
        const idx = Object.keys(groupColorCache).length % COLOR_PALETTE.length;
        groupColorCache[name] = COLOR_PALETTE[idx];
    }
    return groupColorCache[name];
}

function dotOpacity(name) {
    if (!state.highlightedGroup) return 0.85;
    return name === state.highlightedGroup ? 1 : 0.15;
}

// legend
function renderLegend(allRecords) {
    updateLegend(allRecords);
}

function updateLegend(allRecords) {
    const legendEl = d3.select("#legend");
    legendEl.selectAll("*").remove();

    legendEl.append("div").attr("class", "legend-title")
        .text(`Key — ${state.displayMode} (out of ~${getGroupCount(allRecords)} total)`);
}


function getGroupCount(allRecords) {
    const filteredRecords = allRecords.filter(d => state.activeMonths.has(d.month));
    return new Set(filteredRecords.map(d => d[state.displayMode])).size;
}

function refreshDots() {
    d3.selectAll(".dot")
        .attr("opacity", d => dotOpacity(d.name));
}

// controls
function setupControls(allRecords) {

    // buttons
    d3.selectAll("#display-buttons .toggle-btn").on("click", function () {
        state.displayMode = d3.select(this).attr("data-display");
        d3.selectAll("#display-buttons .toggle-btn").classed("active", false);
        d3.select(this).classed("active", true);
        state.highlightedGroup = null;
        // color reset
        Object.keys(groupColorCache).forEach(k => delete groupColorCache[k]);
        updateBoards(allRecords);
        updateLegend(allRecords);
    });

    // month buttons
    d3.selectAll("#month-buttons .toggle-btn").on("click", function () {
        const month = d3.select(this).attr("data-month");
        if (state.activeMonths.has(month)) {
            if (state.activeMonths.size > 1) {
                state.activeMonths.delete(month);
                d3.select(this).classed("active", false);
            }
        } else {
            state.activeMonths.add(month);
            d3.select(this).classed("active", true);
        }
        });

    // season buttons
    d3.selectAll(".season-btn").on("click", function () {
        const season = d3.select(this).attr("data-season");

        // activate-deactivate switch
        const isActive = d3.select(this).classed("active");
        if (isActive) {
            d3.select(this).classed("active", false);
            state.activeMonths = new Set(ALL_MONTHS);
        } else {
            d3.selectAll(".season-btn").classed("active", false);
            d3.select(this).classed("active", true);
            state.activeMonths = new Set(SEASONS[season]);
        }

        d3.selectAll("#month-buttons .toggle-btn").classed("active",
            function () { return state.activeMonths.has(d3.select(this).attr("data-month")); }
        );

        updateBoards(allRecords);
        updateLegend(allRecords);
    });
}
