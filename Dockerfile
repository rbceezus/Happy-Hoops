FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1 NODE_NO_WARNINGS=1
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
