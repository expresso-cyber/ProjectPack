## Unreleased — Split Render frontend/API deployment

- React/Vite can now be deployed as a separate Render Static Site.
- The Express service is API-only in production instead of serving the React build.
- Added configurable `VITE_API_URL` frontend API origin support.
- Added production CORS allowlisting through `FRONTEND_ORIGINS`.
- API-relative archive, raw-file, package, image, and export download URLs are resolved correctly when frontend and API are on different origins.
- Added a root `render.yaml` Blueprint for the two-service Render deployment with SPA history fallback.
- Note: the current API stores ProjectPack data on the local filesystem; persistent storage is still required for data that must survive Render restarts/redeploys.

