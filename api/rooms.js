"use strict";

const {authenticate}=require("../server/supabase.js");
const {json,body,fail}=require("../server/http.js");
const Rooms=require("../server/room-service.js");

module.exports=async function handler(request,response) {
  try {
    if (request.method!=="POST") return json(response,405,{ok:false,error:"Použij POST."});
    const input=await body(request);
    const {client,user}=await authenticate(request);
    const operations={
      create:Rooms.createRoom,
      join:Rooms.joinRoom,
      resume:Rooms.resumeRoom,
      heartbeat:Rooms.heartbeat,
      character:Rooms.setCharacter,
      prepare:Rooms.prepareGame,
      activate:Rooms.activateGame
    };
    const operation=operations[input.action];
    if (!operation) throw new Error("Neznámá operace místnosti.");
    json(response,200,{ok:true,data:await operation(client,user,input)});
  } catch (error) {
    fail(response,error);
  }
};
