const form = document.getElementById('sim-form');
const resultsPre = document.getElementById('results-json');
const calcBtn = document.getElementById('calc');
const saveBtn = document.getElementById('save');
const loadBtn = document.getElementById('load');
const scenariosSelect = document.getElementById('scenarios');
const reportBtn = document.getElementById('report');

// create a friendly results container
let friendlyResults = document.getElementById('friendly-results');
if (!friendlyResults){
  friendlyResults = document.createElement('div');
  friendlyResults.id = 'friendly-results';
  friendlyResults.className = 'card';
  resultsPre.parentNode.insertBefore(friendlyResults, resultsPre);
}

// hide raw JSON by default and add a toggle button
resultsPre.style.display = 'none';
let toggleBtn = document.getElementById('toggle-raw');
if (!toggleBtn) {
  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.id = 'toggle-raw';
  toggleBtn.textContent = 'Show raw JSON';
  toggleBtn.style.marginTop = '8px';
  toggleBtn.style.background = '#6b7280';
  toggleBtn.style.border = 'none';
  toggleBtn.style.color = '#fff';
  toggleBtn.style.padding = '6px 10px';
  toggleBtn.style.borderRadius = '6px';
  toggleBtn.addEventListener('click', ()=>{
    if (resultsPre.style.display === 'none'){
      resultsPre.style.display = 'block';
      toggleBtn.textContent = 'Hide raw JSON';
    } else {
      resultsPre.style.display = 'none';
      toggleBtn.textContent = 'Show raw JSON';
    }
  });
  resultsPre.parentNode.insertBefore(toggleBtn, resultsPre.nextSibling);
}

function formatMoney(v){
  return Number(v||0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
}

async function calc(){
  const data = getFormData(true);
  const errors = validateInputs(data);
  if (errors.length){
    alert('Please fix: ' + errors.join(', '));
    return;
  }
  const res = await fetch('/api/calc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const json = await res.json();
  resultsPre.textContent = JSON.stringify(json,null,2);
  renderFriendlyResults(json);
}

function getFormData(coerceNumbers){
  const fd = new FormData(form);
  const obj = {};
  for (const [k,v] of fd.entries()){
    if (coerceNumbers && ['monthly_invoice_volume','num_ap_staff','avg_hours_per_invoice','hourly_wage','error_rate_manual','error_cost','time_horizon_months','one_time_implementation_cost'].includes(k)){
      obj[k] = Number(v);
    } else {
      obj[k] = v;
    }
  }
  if (!obj.scenario_name) obj.scenario_name = 'Untitled';
  return obj;
}

function validateInputs(data){
  const errs = [];
  if (!data.monthly_invoice_volume || data.monthly_invoice_volume <= 0) errs.push('monthly invoice volume');
  if (!data.time_horizon_months || data.time_horizon_months <= 0) errs.push('time horizon');
  if (!data.hourly_wage || data.hourly_wage < 0) errs.push('hourly wage');
  return errs;
}

async function saveScenario(){
  const data = getFormData();
  const res = await fetch('/api/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const json = await res.json();
  if (json.ok) { await loadList(); alert('Saved'); }
}

async function loadList(){
  const res = await fetch('/api/scenario');
  const json = await res.json();
  scenariosSelect.innerHTML = '';
  if (json.ok){
    json.list.forEach(s=>{
      const o = document.createElement('option');
      o.value = s.id; o.textContent = `${s.scenario_name||s.id} (${new Date(s.created_at).toLocaleString()})`;
      scenariosSelect.appendChild(o);
    });
  }
}

async function loadScenario(){
  const id = scenariosSelect.value;
  if (!id) return alert('select one');
  const res = await fetch(`/api/scenario/${id}`);
  const json = await res.json();
  if (json.ok){
    fillForm(json.scenario);
  }
}

function fillForm(s){
  for (const k in s){
    const el = form.elements[k];
    if (el) el.value = s[k];
  }
}

async function requestReport(){
  const id = scenariosSelect.value;
  if (!id) return alert('Select a saved scenario first');
  const email = prompt('Enter an email to receive the report (gated):');
  if (!email) return;
  const res = await fetch(`/api/report/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
  if (!res.ok) return alert('Error generating report');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `report-${id}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
}

calcBtn.addEventListener('click',calc);
saveBtn.addEventListener('click',saveScenario);
loadBtn.addEventListener('click',loadScenario);
reportBtn.addEventListener('click',requestReport);

window.addEventListener('load', ()=>{ loadList(); });

function renderFriendlyResults(json){
  if (!json || !json.metrics) return;
  const m = json.metrics;
  const positive = m.monthly_net_savings > 0;
  const verdict = positive ? 'Automation looks beneficial' : 'No clear savings — review inputs';
  friendlyResults.innerHTML = `
    <h3>Summary</h3>
    <p><strong>${json.input.scenario_name}</strong></p>
    <p class="verdict">${verdict}</p>
    <table>
      <tr><th>Monthly savings</th><td class="${positive? 'savings-positive':'savings-negative'}">${formatMoney(m.monthly_net_savings)}</td></tr>
      <tr><th>Cumulative (${json.input.time_horizon_months} mo)</th><td>${formatMoney(m.cumulative_savings)}</td></tr>
      <tr><th>Estimated ROI</th><td>${(m.roi||0).toFixed(2)}</td></tr>
      <tr><th>Payback</th><td>${m.payback_months? m.payback_months + ' months' : 'N/A'}</td></tr>
    </table>
    <p class="muted">Tip: Save the scenario to compare later.</p>
  `;
}
