# Static landing site. Build first: `yarn workspace @biddaloy/landing build` writes landing/dist.
# TLS and the Cloudflare-only rule belong to the edge, so this container speaks plain HTTP on 80.
# Digest is the same nginx pin as deploy/edge.yml.
FROM nginx:1.31-alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2
COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
