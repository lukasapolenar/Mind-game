(function (root,factory) {
  const calibration=factory();
  if (typeof module==="object"&&module.exports) module.exports=calibration;
  if (root) root.BoardCalibration=calibration;
})(typeof globalThis!=="undefined"?globalThis:this,function () {
  "use strict";

  const rowY=Object.freeze([213,268,325,384,447,514,585,659,737,823,913]);
  const rowX=Object.freeze([
    Object.freeze([300,368,436,504,572,640,708,776,844,912,980]),
    Object.freeze([290,361,431,501,571,640,710,779,848,917,992]),
    Object.freeze([280,354,427,498,569,641,712,783,855,926,1005]),
    Object.freeze([269,346,421,494,568,642,715,788,862,935,1018]),
    Object.freeze([258,338,415,492,568,643,719,795,871,947,1030]),
    Object.freeze([246,328,410,490,568,643,724,802,880,958,1042]),
    Object.freeze([233,318,401,484,565,645,726,807,889,971,1057]),
    Object.freeze([220,307,394,480,564,646,731,815,899,983,1075]),
    Object.freeze([207,297,386,474,562,646,735,821,908,995,1087]),
    Object.freeze([191,284,377,468,558,647,738,829,920,1010,1099]),
    Object.freeze([174,272,368,465,557,648,740,832,925,1018,1110])
  ]);
  const intersections=Object.freeze(rowY.map((y,row)=>
    Object.freeze(rowX[row].map(x=>Object.freeze({x,y})))
  ));

  return Object.freeze({
    imageWidth:1254,
    imageHeight:1254,
    rows:10,
    columns:10,
    intersections,
    verificationCells:Object.freeze(["A1","A10","J1","J10","E5","F6"])
  });
});
