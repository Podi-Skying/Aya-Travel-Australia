# Google Calendar sync

The site can push the trip to one dedicated Google Calendar. It is one-way: changes on the site reach the calendar, not the reverse. Your other calendars and any event the site did not create are never changed.

It stays off until both settings below exist.

## Setup

1. In Google Cloud, open the project that holds the Maps key and enable **Google Calendar API**.
2. Under **IAM & Admin → Service Accounts**, create a service account. Give it no roles.
3. On that account, open **Keys → Add key → JSON** and download the file. Treat it as a password: do not send it in chat or commit it.
4. In Google Calendar, create a calendar, for example `2026澳洲旅程with Aya`.
5. In that calendar's settings, under **Share with specific people**, add the service account's email with **Make changes to events**.
6. Under **Integrate calendar**, copy the **Calendar ID**.
7. In Vercel → Settings → Environment Variables, add:
   - `GOOGLE_CALENDAR_ID`: the Calendar ID
   - `GOOGLE_CALENDAR_SA_JSON`: the JSON file's contents, as is or base64-encoded
8. Redeploy.
9. Sign in, open the ⋯ menu on any day and press **同步 Google 日曆**.

## How it behaves

- It syncs in the background after every trip change. The button runs a full sync and shows the last time, event count and any error.
- Timed stops become events in that day's time zone. The end comes from the stop's duration, else the next stop, else one hour. Stays become all-day events. Notes with no time are skipped.
- This calendar includes owner details such as addresses and notes. Do not make it public, and share it only with people who may see them.
- To turn it off, remove either setting and redeploy. Events already in the calendar stay there.
