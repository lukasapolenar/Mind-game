"use strict";

const {authenticate}=require("../server/supabase.js");
const {json,body,fail}=require("../server/http.js");
const {submitAction}=require("../server/game-service.js");

module.exports=async function handler(request,response) {
  try {
    if (request.method!=="POST") return json(response,405,{ok:false,error:"Použij POST."});
    const input=await body(request);
    const {client,user}=await authenticate(request);
    if (input.action!=="submit") throw new Error("Neznámá herní operace.");
    json(response,200,{ok:true,data:await submitAction(client,user,input)});
  } catch (error) {
    fail(response,error);
  }
};
