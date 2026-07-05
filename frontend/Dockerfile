# Frontend (Next.js) — production build then run. Context is the repo root.
# NEXT_PUBLIC_* must be present at BUILD time (Next inlines them into the client
# bundle). Server-only vars (BACKEND_URL, ADMIN_API_TOKEN) are injected at RUNTIME
# via docker-compose env_file and never reach the browser.
FROM node:20-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci
COPY frontend ./frontend
RUN npm run build --workspace=frontend

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/frontend/.next ./frontend/.next
COPY --from=build /app/frontend/next.config.js ./frontend/next.config.js
WORKDIR /app/frontend
EXPOSE 3000
CMD ["npm", "run", "start:docker"]
