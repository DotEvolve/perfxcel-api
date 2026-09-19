FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

ARG NPM_TOKEN
RUN echo "@dotevolve:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc

# Install all deps (including devDependencies for tsc)
RUN npm install --legacy-peer-deps
RUN rm -f .npmrc

COPY . .

RUN npm run build

# Prune dev dependencies after build
RUN npm prune --omit=dev --legacy-peer-deps

EXPOSE 3000

CMD ["node", "dist/server.js"]
