const{Pool}=require('pg');
new Pool({connectionString:'postgresql://postgres:postgres@localhost:5432/smartrouter'})
  .query("SELECT column_name FROM information_schema.columns WHERE table_name='delegation_logs' ORDER BY ordinal_position")
  .then(r=>{console.log(JSON.stringify(r.rows,null,2));process.exit(0);})
  .catch(e=>{console.error(e.message);process.exit(1);});
