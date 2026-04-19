// language bar chart code goes here  
let height = 500;
let width = 2400;
let margin = 50;

let frame = d3.select("#boards")
        .append("svg")
        .attr("width", width)
        .attr("height", height+500); 

let linearScale = d3.scaleLinear()
        .domain([20, 1600])
        .range([height-margin, margin]);

frame.append("g")
        .attr("transform", `translate(${margin}, 0)`)
        .call(d3.axisLeft(linearScale));
