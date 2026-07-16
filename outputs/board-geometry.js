(function (root,factory) {
  const calibration=typeof module==="object"&&module.exports
    ? require("./board-calibration.js")
    : root.BoardCalibration;
  const geometry=factory(calibration);
  if (typeof module==="object"&&module.exports) module.exports=geometry;
  if (root) root.BoardGeometry=geometry;
})(typeof globalThis!=="undefined"?globalThis:this,function (calibration) {
  "use strict";

  if (!calibration) throw new Error("Chybí kalibrace herního pole.");

  const {imageWidth,imageHeight,rows,columns,intersections}=calibration;

  function assertCell(row,column) {
    if (!Number.isInteger(row)||row<0||row>=rows||
        !Number.isInteger(column)||column<0||column>=columns) {
      throw new Error("Požadované grafické pole neexistuje.");
    }
  }

  function point(row,column) {
    if (!Number.isInteger(row)||row<0||row>rows||
        !Number.isInteger(column)||column<0||column>columns) {
      throw new Error("Požadovaný kalibrační bod neexistuje.");
    }
    return intersections[row][column];
  }

  function polygon(row,column) {
    assertCell(row,column);
    return [
      point(row,column),
      point(row,column+1),
      point(row+1,column+1),
      point(row+1,column)
    ].map(value=>({...value}));
  }

  function center(row,column) {
    const corners=polygon(row,column);
    return {
      x:corners.reduce((sum,value)=>sum+value.x,0)/corners.length,
      y:corners.reduce((sum,value)=>sum+value.y,0)/corners.length
    };
  }

  function distance(a,b) {
    return Math.hypot(b.x-a.x,b.y-a.y);
  }

  function cellSize(row,column) {
    const corners=polygon(row,column);
    const horizontal=(distance(corners[0],corners[1])+distance(corners[3],corners[2]))/2;
    const vertical=(distance(corners[0],corners[3])+distance(corners[1],corners[2]))/2;
    return Math.min(horizontal,vertical);
  }

  function percent(value,axis) {
    return value/(axis==="x"?imageWidth:imageHeight)*100;
  }

  function layout(row,column) {
    const cellCenter=center(row,column);
    const size=cellSize(row,column);
    return {
      row,
      column,
      center:cellCenter,
      centerPercent:{x:percent(cellCenter.x,"x"),y:percent(cellCenter.y,"y")},
      size,
      sizePercent:percent(size,"x"),
      polygon:polygon(row,column)
    };
  }

  function polygonPoints(row,column) {
    return polygon(row,column).map(value=>`${value.x},${value.y}`).join(" ");
  }

  function cellLabel(row,column) {
    return `${String.fromCharCode(65+row)}${column+1}`;
  }

  return Object.freeze({
    imageWidth,
    imageHeight,
    rows,
    columns,
    point,
    polygon,
    polygonPoints,
    center,
    cellSize,
    layout,
    cellLabel
  });
});
