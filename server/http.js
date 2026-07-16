"use strict";

function json(response,status,payload) {
  response.status(status).setHeader("content-type","application/json; charset=utf-8");
  response.setHeader("cache-control","no-store");
  response.end(JSON.stringify(payload));
}

async function body(request) {
  if (request.body&&typeof request.body==="object") return request.body;
  let input="";
  for await (const chunk of request) input+=chunk;
  return input?JSON.parse(input):{};
}

function fail(response,error) {
  const status=Number(error.statusCode)||400;
  json(response,status,{ok:false,error:error.message||"Požadavek se nepodařilo zpracovat."});
}

module.exports={json,body,fail};
