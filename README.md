# Dodo Marketing Dashboard

Express + SQLite dashboard for Mindbox and Dodo marketing reports.

## Run locally

```bash
npm ci
DASHBOARD_USER=admin DASHBOARD_PASSWORD=change-me npm start
```

## Marketing data

The **Dodo Маркетинг** tab accepts an aggregated CSV with these columns:

```text
Дата;Пиццерия;Новые клиенты;Промокод;Срабатывания;Уникальные клиенты;Новые клиенты по промокоду;Заказы;Выручка;Скидка
```

Dates can be `YYYY-MM-DD` or `DD.MM.YYYY`. Re-uploading the same date, unit, and promo code updates the existing row instead of creating a duplicate.

### Automated upload

Set a long random `DASHBOARD_INGEST_TOKEN` in Railway and in the environment where the uploader runs. Do not reuse the dashboard password.

```bash
export DASHBOARD_URL="https://dododashboard-production.up.railway.app"
export DASHBOARD_INGEST_TOKEN="replace-with-a-long-random-token"
node scripts/upload-marketing.js ./report.csv
```

The script sends the CSV to `POST /api/marketing/import` with a Bearer token. The same endpoint can be called from any ETL or scheduled job.
