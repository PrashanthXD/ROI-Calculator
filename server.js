const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const Database = require('./db');
const fs = require('fs');
const mime = require('mime');
let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (e) { /* optional */ }

const app = express();
const port = process.env.PORT || 3000;

// Internal constants
const automated_cost_per_invoice = 0.20;
const error_rate_auto = 0.1;
const time_saved_per_invoice = 8; // minutes
const min_roi_boost_factor = 1.1;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB
const db = new Database(path.join(__dirname, 'data.sqlite'));

function calculateMetrics(input) {
  // Input assumptions: monthly_invoice_volume, num_ap_staff, avg_hours_per_invoice (hours), hourly_wage,
  // error_rate_manual (fraction), error_cost, time_horizon_months, one_time_implementation_cost

  const monthly_invoice_volume = Number(input.monthly_invoice_volume) || 0;
  const num_ap_staff = Number(input.num_ap_staff) || 0;
  const avg_hours_per_invoice = Number(input.avg_hours_per_invoice) || 0;
  const hourly_wage = Number(input.hourly_wage) || 0;
  const error_rate_manual = Number(input.error_rate_manual) || 0;
  const error_cost = Number(input.error_cost) || 0;
  const time_horizon_months = Number(input.time_horizon_months) || 12;
  const one_time_implementation_cost = Number(input.one_time_implementation_cost) || 0;

  // Manual monthly labor cost
  const manual_monthly_hours = monthly_invoice_volume * avg_hours_per_invoice;
  const manual_monthly_labor_cost = manual_monthly_hours * hourly_wage;

  // Automated monthly processing cost
  const automated_monthly_processing_cost = monthly_invoice_volume * automated_cost_per_invoice;

  // Time savings: time_saved_per_invoice in minutes -> convert to hours
  const time_saved_hours_per_month = (monthly_invoice_volume * (time_saved_per_invoice/60));
  const labor_savings = Math.max(0, time_saved_hours_per_month * hourly_wage);

  // Error costs
  const manual_error_costs_monthly = monthly_invoice_volume * error_rate_manual * error_cost;
  const automated_error_costs_monthly = monthly_invoice_volume * error_rate_auto * error_cost;
  const error_cost_savings = Math.max(0, manual_error_costs_monthly - automated_error_costs_monthly);

  // Total monthly savings: reduced labor cost + error savings - automated processing cost
  const monthly_savings = Math.max(0, (manual_monthly_labor_cost - automated_monthly_processing_cost - (manual_monthly_labor_cost - labor_savings)) + error_cost_savings + labor_savings - automated_monthly_processing_cost);

  // Simpler: compute baseline total monthly cost (labor + manual errors), new total monthly cost (automated processing + automated errors)
  const baseline_monthly_total = manual_monthly_labor_cost + manual_error_costs_monthly;
  const new_monthly_total = automated_monthly_processing_cost + automated_error_costs_monthly + Math.max(0, manual_monthly_labor_cost - labor_savings - (num_ap_staff?0:0));
  const monthly_net_savings = baseline_monthly_total - new_monthly_total;

  // ROI over time horizon: cumulative savings minus one-time cost
  const cumulative_savings = monthly_net_savings * time_horizon_months - one_time_implementation_cost;
  const roi = cumulative_savings / (one_time_implementation_cost || 1);

  // Payback period in months
  let payback_months = null;
  if (monthly_net_savings > 0) {
    payback_months = Math.ceil(one_time_implementation_cost / monthly_net_savings);
  }

  // Enforce min ROI boost factor as a note
  const adjusted_roi = roi * min_roi_boost_factor;

  return {
    baseline_monthly_total,
    new_monthly_total,
    monthly_net_savings,
    cumulative_savings,
    roi: adjusted_roi,
    payback_months,
    details: {
      manual_monthly_labor_cost,
      automated_monthly_processing_cost,
      manual_error_costs_monthly,
      automated_error_costs_monthly,
      labor_savings,
      time_saved_hours_per_month
    }
  };
}

app.post('/api/calc', (req, res) => {
  try {
    const payload = coerceAndValidate(req.body);
    if (!payload.valid) return res.status(400).json({ok:false, error: payload.error});
    const metrics = calculateMetrics(payload.data);
    res.json({ok:true, input:payload.data, metrics});
  } catch (err) {
    console.error(err);
    res.status(500).json({ok:false, error:err.message});
  }
});

// CRUD: create/update scenario
app.post('/api/scenario', (req, res) => {
  try {
    const payload = coerceAndValidate(req.body);
    if (!payload.valid) return res.status(400).json({ok:false, error: payload.error});
    const id = req.body.id || uuidv4();
    const scenario = Object.assign({}, payload.data, {id});
    db.saveScenario(scenario);
    res.json({ok:true, scenario});
  } catch (err) {
    console.error(err);
    res.status(500).json({ok:false, error:err.message});
  }
});

app.get('/api/scenario', (req, res) => {
  try {
    const list = db.listScenarios();
    res.json({ok:true, list});
  } catch (err) {
    console.error(err);
    res.status(500).json({ok:false, error:err.message});
  }
});

app.get('/api/scenario/:id', (req, res) => {
  try {
    const s = db.getScenario(req.params.id);
    if (!s) return res.status(404).json({ok:false, error:'not found'});
    res.json({ok:true, scenario:s});
  } catch (err) {
    console.error(err);
    res.status(500).json({ok:false, error:err.message});
  }
});

app.delete('/api/scenario/:id', (req, res) => {
  try {
    db.deleteScenario(req.params.id);
    res.json({ok:true});
  } catch (err) {
    console.error(err);
    res.status(500).json({ok:false, error:err.message});
  }
});

// Friendly HTML report (open in browser for quick, printable view)
app.get('/report/:id', (req, res) => {
  try {
    const id = req.params.id;
    const scenario = db.getScenario(id);
    if (!scenario) return res.status(404).send('<h1>Scenario not found</h1>');
    const metrics = calculateMetrics(scenario);
    const html = generateReportHtml(scenario, metrics, {printFriendly:true});
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('<h1>Error generating report</h1>');
  }
});

// Report generation API: returns PDF when requested via POST /api/report/:id with an email (keeps gating behavior)
app.post('/api/report/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const email = req.body.email;
    if (!email) return res.status(400).json({ok:false,error:'email required'});
    const scenario = db.getScenario(id);
    if (!scenario) return res.status(404).json({ok:false,error:'scenario not found'});

    const metrics = calculateMetrics(scenario);
    const html = generateReportHtml(scenario, metrics, {printFriendly:true});
    // If SMTP credentials provided, attempt to send email with report (HTML as body). Otherwise return HTML (or PDF if puppeteer available)
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || 'no-reply@example.com';

    // Try to generate PDF if puppeteer available
    let pdfBuffer = null;
    if (puppeteer){
      try {
        const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
        const page = await browser.newPage();
        await page.setContent(html, {waitUntil:'networkidle0'});
        pdfBuffer = await page.pdf({format:'A4', printBackground:true});
        await browser.close();
      } catch (e) {
        console.warn('puppeteer PDF generation failed:', e && e.message);
        pdfBuffer = null;
      }
    }

    if (smtpHost && smtpUser && smtpPass){
      // send email with attachment (PDF if available, otherwise HTML)
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: smtpHost, port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587, secure: false, auth:{user:smtpUser,pass:smtpPass} });
      const mailOptions = {
        from: smtpFrom,
        to: email,
        subject: `ROI Report - ${scenario.scenario_name || scenario.id}`,
        html: html,
      };
      if (pdfBuffer) {
        mailOptions.attachments = [{filename:`report-${id}.pdf`,content:pdfBuffer}];
      }
      try {
        await transporter.sendMail(mailOptions);
        return res.json({ok:true, emailed:true});
      } catch (mailErr){
        console.error('Failed to send email:', mailErr);
        // fallback to returning HTML/PDF
      }
    }

    // If not emailing or sending failed, return PDF if available, else HTML
    if (pdfBuffer){
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="report-${id}.pdf"`);
      return res.send(pdfBuffer);
    }
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).json({ok:false, error:err.message});
  }
});

function coerceAndValidate(body){
  try {
    const fields = {
      scenario_name: body.scenario_name || 'Untitled',
      monthly_invoice_volume: Number(body.monthly_invoice_volume),
      num_ap_staff: Number(body.num_ap_staff),
      avg_hours_per_invoice: Number(body.avg_hours_per_invoice),
      hourly_wage: Number(body.hourly_wage),
      error_rate_manual: Number(body.error_rate_manual),
      error_cost: Number(body.error_cost),
      time_horizon_months: Number(body.time_horizon_months),
      one_time_implementation_cost: Number(body.one_time_implementation_cost)
    };
    // basic validation
    if (!Number.isFinite(fields.monthly_invoice_volume) || fields.monthly_invoice_volume < 0) return {valid:false, error:'monthly_invoice_volume must be a non-negative number'};
    if (!Number.isFinite(fields.time_horizon_months) || fields.time_horizon_months <= 0) return {valid:false, error:'time_horizon_months must be a positive number'};
    if (!Number.isFinite(fields.hourly_wage) || fields.hourly_wage < 0) return {valid:false, error:'hourly_wage must be a non-negative number'};
    if (!Number.isFinite(fields.error_rate_manual) || fields.error_rate_manual < 0) return {valid:false, error:'error_rate_manual must be a non-negative number'};
    return {valid:true, data:fields};
  } catch (e){
    return {valid:false, error:'invalid input'};
  }
}

function formatMoney(v){
  return Number(v||0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
}

function generateReportHtml(scenario, metrics, opts){
  opts = opts || {};
  const s = scenario;
  const m = metrics;
  const lines = [];
  lines.push('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
  lines.push('<title>ROI Report</title>');
  lines.push('<style>body{font-family:Helvetica,Arial,sans-serif;padding:20px;color:#111} .wrap{max-width:800px;margin:0 auto} h1{color:#0b74de} .card{background:#fff;padding:14px;border-radius:8px;box-shadow:0 2px 8px rgba(16,24,40,0.06);margin-bottom:12px} table{width:100%;border-collapse:collapse} th{text-align:left;padding:6px;color:#444;width:40%} td{padding:6px;color:#000} .big{font-size:1.4rem;font-weight:700;color:#0b5} .muted{color:#666}</style>');
  lines.push('</head><body><div class="wrap">');
  lines.push(`<h1>ROI Report — ${s.scenario_name || s.id}</h1>`);
  lines.push('<p class="muted">This report summarizes expected monthly savings, cumulative savings, ROI, and payback period based on the inputs provided.</p>');

  lines.push('<div class="card"><h3>Inputs</h3><table>');
  Object.keys(s).filter(k=>!['id','created_at'].includes(k)).forEach(k=>{
    lines.push(`<tr><th>${humanizeKey(k)}</th><td>${s[k]}</td></tr>`);
  });
  lines.push('</table></div>');

  lines.push('<div class="card"><h3>Key results</h3><table>');
  lines.push(`<tr><th>Baseline monthly cost</th><td>${formatMoney(m.baseline_monthly_total)}</td></tr>`);
  lines.push(`<tr><th>Estimated monthly cost after automation</th><td>${formatMoney(m.new_monthly_total)}</td></tr>`);
  lines.push(`<tr><th class="big">Estimated monthly savings</th><td class="big">${formatMoney(m.monthly_net_savings)}</td></tr>`);
  lines.push(`<tr><th>Cumulative savings (${(s.time_horizon_months||12)} months)</th><td>${formatMoney(m.cumulative_savings)}</td></tr>`);
  lines.push(`<tr><th>Estimated ROI (adjusted)</th><td>${(m.roi||0).toFixed(2)}</td></tr>`);
  lines.push(`<tr><th>Payback period</th><td>${m.payback_months? m.payback_months + ' months' : 'More than horizon / not recoverable'}</td></tr>`);
  lines.push('</table></div>');

  lines.push('<div class="card"><h3>Details</h3><table>');
  const d = m.details || {};
  lines.push(`<tr><th>Manual labor cost / month</th><td>${formatMoney(d.manual_monthly_labor_cost)}</td></tr>`);
  lines.push(`<tr><th>Automated processing cost / month</th><td>${formatMoney(d.automated_monthly_processing_cost)}</td></tr>`);
  lines.push(`<tr><th>Manual error cost / month</th><td>${formatMoney(d.manual_error_costs_monthly)}</td></tr>`);
  lines.push(`<tr><th>Automated error cost / month</th><td>${formatMoney(d.automated_error_costs_monthly)}</td></tr>`);
  lines.push(`<tr><th>Estimated time saved (hrs / month)</th><td>${(d.time_saved_hours_per_month||0).toFixed(2)}</td></tr>`);
  lines.push('</table></div>');

  lines.push('<p class="muted">Notes: This is a model and uses simplified assumptions. For a detailed analysis, validate local costs and processes.</p>');
  lines.push('</div></body></html>');
  return lines.join('\n');
}

function humanizeKey(k){
  return k.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
