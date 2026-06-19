# KNUST SafeTrack — Project Instructions

## Commands

### Server (Backend)
- Start server: `node server/server.js`
- Backup database: `node server/backup_db.js`

### Frontend (Static Files)
- Serve frontend: Use a static file server in the project root.

## Architecture

- Root directory: Contains all frontend static files (`index.html`, `admin.html`, `account.html`, `track.html`, `styles.css`, `admin.css`, `app.js`, `admin.js`, `account.js`).
- `server/`: Contains backend Express API (`server.js`), SQLite database (`inventory.db`), and database utilities (`db.js`, `backup_db.js`).

## Key Decisions

- SQLite database (`server/inventory.db`) stores incident reports, user profiles, and logs.
- Password hashing is implemented using `bcrypt`, and user session authentication uses JSON Web Tokens (`jsonwebtoken`).
- Vanilla HTML, CSS, and JS are used for the frontend without frameworks to maintain lightweight load times and maximum compatibility.

## Domain Knowledge

- **SafeTrack**: Safety incident tracking dashboard system for KNUST.
- **Incidents**: Tracks safety incidents, status changes, categories, and resolutions.
