# SARsight backend on a server

Runs the API with Docker and HTTPS (Caddy). Built places are kept in a Docker volume.

```bash
cd deploy/server
echo "SARSIGHT_HOST=<ip-with-dashes>.sslip.io" > .env     # or your own domain pointing at the server
echo "SARSIGHT_CUSTOM_NISAR=1" > backend.env               # then add EARTHDATA_USERNAME / EARTHDATA_PASSWORD
docker compose up -d --build
```

Ports 80 and 443 must be open (cloud firewall and the server's own firewall). Update to the latest main with
`docker compose build --no-cache backend && docker compose up -d`. Point the frontend at it with
`NEXT_PUBLIC_API=https://<SARSIGHT_HOST>`.
