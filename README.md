# Invoicing ROI Simulator

Local prototype for estimating ROI when switching from manual to automated invoicing.

## Quick start

1. Install Node.js (LTS) and open a terminal in the project folder.

2. Install dependencies:

```powershell
npm install
```

3. Start the server:

```powershell
npm start
```

Open http://localhost:3000 in your browser.

## Email-gated report

The report endpoint requires an `email` parameter when calling `POST /api/report/:id`.

If you provide SMTP credentials as environment variables, the server will email the report (PDF if Puppeteer is available, otherwise HTML) to the address you provide.

Set the following environment variables (example using PowerShell):

```powershell
$env:SMTP_HOST = 'smtp.example.com'
$env:SMTP_PORT = '587'
$env:SMTP_USER = 'smtp-user'
$env:SMTP_PASS = 'smtp-pass'
$env:SMTP_FROM = 'no-reply@yourdomain.com'
```

Then call the endpoint (example):

```powershell
# using Invoke-RestMethod
Invoke-RestMethod -Uri http://localhost:3000/api/report/<scenario-id> -Method Post -Body (@{ email='you@example.com' } | ConvertTo-Json) -ContentType 'application/json'
```

If SMTP vars are not set, the server will return the HTML report directly (or a PDF if puppeteer is installed and working).

## ngrok (quick public demo)

If you want a temporary public URL, install ngrok and run:

```powershell
# after installing ngrok
ngrok http 3000
```

Use the public URL shown by ngrok to demo the app.

## Notes

- Storage: the app stores scenarios in `scenarios.json` in the project folder.
- Puppeteer is optional and not required to run the app. If you need server-side PDFs, install puppeteer and ensure Chromium can be downloaded by npm.
- The UI performs basic client-side validation; the server now also validates inputs.

## Next steps

- Add stronger server-side validation or schema validation (e.g., with Joi).
- Add unit tests for `calculateMetrics`.
- Add authentication and secure report links for production.