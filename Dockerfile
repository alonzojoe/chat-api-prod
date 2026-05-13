FROM node:20-alpine

WORKDIR /app

# Amazon RDS/DocumentDB TLS trust anchor (used when MONGO_TLS_CA_FILE is set, e.g. App Runner).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-global-bundle.pem

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/server.js"]
