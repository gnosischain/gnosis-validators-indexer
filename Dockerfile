FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --frozen-lockfile 2>/dev/null || npm install --omit=dev
COPY --from=builder /app/build ./build
EXPOSE 3001
CMD ["node", "build/index.js"]
