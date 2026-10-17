FROM node:22-alpine

WORKDIR /app

# Keep dependency installation in a cached image layer. The source itself is
# bind-mounted by Compose so application edits still hot reload.
COPY package.json package-lock.json ./
RUN npm ci \
    && sha256sum package-lock.json | awk '{print $1}' \
       > node_modules/.danpahq-package-lock.sha256

COPY docker-entrypoint.sh ./docker-entrypoint.sh

EXPOSE 3000

CMD ["sh", "/app/docker-entrypoint.sh"]
