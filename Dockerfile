FROM oven/bun:1.3.14

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

RUN mkdir -p /data/state && chown -R bun:bun /data
ENV SUWAPPU_PERPS_STATE_DIR=/data/state
USER bun
VOLUME ["/data"]

ENTRYPOINT ["bun", "src/cli.ts"]
CMD ["--help"]
