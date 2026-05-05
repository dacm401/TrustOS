const{Pool}=require('pg');
new Pool({connectionString:'postgresql://postgres:postgres@localhost:5432/smartrouter'})
  .query("SELECT id,routing_layer,routed_action,llm_confidence,latency_ms FROM delegation_logs LIMIT 3")
  .then(r=>{console.log(JSON.stringify(r.rows,null,2));process.exit(0);})
  .catch(e=>{console.error(e.message);process.exit(1);});
