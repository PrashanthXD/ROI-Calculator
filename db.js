const fs = require('fs');
const path = require('path');

class DB {
  constructor(dbPath){
    this.path = dbPath || path.join(__dirname,'scenarios.json');
    this._ensure();
  }
  _ensure(){
    try {
      if (!fs.existsSync(this.path)) fs.writeFileSync(this.path, JSON.stringify({scenarios:[]},null,2));
    } catch (err){
      throw err;
    }
  }
  _read(){
    const raw = fs.readFileSync(this.path,'utf8');
    return JSON.parse(raw);
  }
  _write(obj){
    fs.writeFileSync(this.path, JSON.stringify(obj,null,2));
  }
  saveScenario(scenario){
    const db = this._read();
    const idx = db.scenarios.findIndex(s => s.id === scenario.id);
    const row = Object.assign({}, scenario, {created_at: Date.now()});
    if (idx >= 0) db.scenarios[idx] = row; else db.scenarios.unshift(row);
    this._write(db);
  }
  listScenarios(){
    const db = this._read();
    return db.scenarios.map(s=>({id:s.id, scenario_name: s.scenario_name, created_at: s.created_at}));
  }
  getScenario(id){
    const db = this._read();
    return db.scenarios.find(s=>s.id===id) || null;
  }
  deleteScenario(id){
    const db = this._read();
    db.scenarios = db.scenarios.filter(s=>s.id!==id);
    this._write(db);
  }
}

module.exports = DB;
