"use strict";

function required(name) {
  const value=process.env[name];
  if (!value) throw new Error(`Chybí proměnná prostředí ${name}.`);
  return value;
}

class Query {
  constructor(client,table) {
    this.client=client;
    this.table=table;
    this.method="GET";
    this.params=new URLSearchParams();
    this.headers={};
    this.payload=undefined;
    this.expectSingle=false;
    this.allowEmpty=false;
  }
  select(columns="*") { this.params.set("select",columns); return this; }
  insert(payload) {
    this.method="POST"; this.payload=payload;
    this.headers.Prefer="return=representation";
    return this;
  }
  update(payload) {
    this.method="PATCH"; this.payload=payload;
    this.headers.Prefer="return=representation";
    return this;
  }
  eq(column,value) { this.params.append(column,`eq.${value}`); return this; }
  lt(column,value) { this.params.append(column,`lt.${value}`); return this; }
  order(column,options={}) {
    this.params.set("order",`${column}.${options.ascending===false?"desc":"asc"}`);
    return this;
  }
  single() { this.expectSingle=true; return this; }
  maybeSingle() { this.expectSingle=true; this.allowEmpty=true; return this; }
  then(resolve,reject) { return this.execute().then(resolve,reject); }
  async execute() {
    try {
      const response=await this.client.request(`/rest/v1/${this.table}?${this.params}`,{
        method:this.method,headers:this.headers,
        body:this.payload===undefined?undefined:JSON.stringify(this.payload)
      });
      let data=response.status===204?null:await response.json();
      if (!response.ok) return {data:null,error:data};
      if (this.expectSingle) {
        if (Array.isArray(data)) {
          if (!data.length&&this.allowEmpty) data=null;
          else if (data.length===1) data=data[0];
          else return {data:null,error:{message:`Očekáván jeden záznam, nalezeno ${data.length}.`}};
        }
      }
      return {data,error:null};
    } catch (error) {
      return {data:null,error};
    }
  }
}

class SupabaseAdmin {
  constructor() {
    this.url=required("SUPABASE_URL").replace(/\/$/,"");
    this.key=required("SUPABASE_SERVICE_ROLE_KEY");
    this.auth={
      getUser:async token=>{
        try {
          const response=await this.request("/auth/v1/user",{headers:{Authorization:`Bearer ${token}`}});
          const user=await response.json();
          return response.ok?{data:{user},error:null}:{data:{user:null},error:user};
        } catch (error) {
          return {data:{user:null},error};
        }
      }
    };
  }
  request(path,options={}) {
    return fetch(`${this.url}${path}`,{
      ...options,
      headers:{
        apikey:this.key,
        Authorization:`Bearer ${this.key}`,
        "content-type":"application/json",
        ...options.headers
      }
    });
  }
  from(table) { return new Query(this,table); }
  async rpc(name,payload) {
    try {
      const response=await this.request(`/rest/v1/rpc/${name}`,{method:"POST",body:JSON.stringify(payload)});
      const data=response.status===204?null:await response.json();
      return response.ok?{data,error:null}:{data:null,error:data};
    } catch (error) {
      return {data:null,error};
    }
  }
}

function adminClient() {
  return new SupabaseAdmin();
}

async function authenticate(request) {
  const header=request.headers.authorization||request.headers.Authorization||"";
  const token=header.startsWith("Bearer ")?header.slice(7):"";
  if (!token) throw Object.assign(new Error("Chybí přihlášení hráče."),{statusCode:401});
  const client=adminClient();
  const {data,error}=await client.auth.getUser(token);
  if (error||!data.user) throw Object.assign(new Error("Relace hráče není platná."),{statusCode:401});
  return {client,user:data.user};
}

module.exports={adminClient,authenticate};
