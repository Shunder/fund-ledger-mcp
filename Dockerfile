FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node . ./
ENV NODE_ENV=production TZ=Asia/Shanghai PORT=3000
USER node
EXPOSE 3000
CMD ["node","src/index.js","--http"]
