# Static export served by a tiny static server.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build
FROM node:20-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/out ./out
EXPOSE 3000
CMD ["serve", "-s", "out", "-l", "3000"]
