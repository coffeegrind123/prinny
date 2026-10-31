## Builder
# Pinned by digest, not just tag: a tag is mutable, so `node:24.13.1-alpine`
# can be repointed at different content at any time. Refresh with:
#   docker buildx imagetools inspect node:<version>-alpine --format '{{.Manifest.Digest}}'
# (or `curl` the registry manifest and read the Docker-Content-Digest header).
FROM node:24.13.1-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03 AS builder

WORKDIR /src

COPY .npmrc package.json package-lock.json /src/
RUN npm ci
COPY . /src/
# Same rebrand publish-webapp.yml applies. Without it this image builds
# straight from source and ships as "Cinny": the script is the only thing
# that renames the title, manifest and UI strings, and nothing else in the
# repo calls it. Safe here because the checkout is throwaway -- it rewrites
# files in place, which is why it is NOT wired into `npm run build`.
RUN node scripts/rebrand.mjs
# Shown in About; the build context has no .git to read it from.
#   docker build --build-arg APP_COMMIT=$(git rev-parse --short HEAD) .
ARG APP_COMMIT=
ENV APP_COMMIT=$APP_COMMIT
ENV NODE_OPTIONS=--max_old_space_size=4096
RUN npm run build


## App
FROM nginx:1.31.2-alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa

COPY --from=builder /src/dist /app
COPY --from=builder /src/docker-nginx.conf /etc/nginx/conf.d/default.conf

# Run nginx unprivileged (UID/GID 101 = the `nginx` user that ships in the
# image). That requires three things beyond the USER line:
#   * a listen port above 1024 — docker-nginx.conf listens on 8080;
#   * a pid file the user can write — /var/run is root-owned, so move it to
#     /tmp and drop the `user` directive (only meaningful for a root master);
#   * writable temp/cache dirs — nginx buffers request bodies, proxying and
#     fastcgi responses under /var/cache/nginx.
RUN rm -rf /usr/share/nginx/html \
  && ln -s /app /usr/share/nginx/html \
  && sed -i -e '/^user  *nginx;/d' -e 's#^pid .*#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
  && mkdir -p /var/cache/nginx/client_temp /var/cache/nginx/proxy_temp \
       /var/cache/nginx/fastcgi_temp /var/cache/nginx/uwsgi_temp /var/cache/nginx/scgi_temp \
  && chown -R 101:101 /var/cache/nginx /etc/nginx/conf.d /app \
  && chmod -R a-w /app

USER 101:101

EXPOSE 8080

# Healthcheck via the SPA entrypoint; the image has no curl, wget is BusyBox's.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/index.html || exit 1
