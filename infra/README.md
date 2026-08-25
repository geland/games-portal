# Games infrastructure

Terraform owns the release bucket and both public custom domains. Wrangler owns
the Worker, its static assets, and bindings. Keeping the Worker hostname out of
`wrangler.jsonc` lets routine deploys use a script-scoped token without asking
for zone-wide Workers Routes access.

Authenticate through environment variables and pass the non-secret IDs as
Terraform variables:

```sh
export CLOUDFLARE_API_TOKEN=...
export TF_VAR_cloudflare_account_id=...
export TF_VAR_cloudflare_zone_id=...
terraform init
terraform plan
terraform apply
```

The bucket has `prevent_destroy`. Do not remove that guard or destroy the
resource to solve a configuration problem. If the bucket already exists before
Terraform is introduced, import it rather than recreating it.

Cache and transform rules intentionally are not defined here. A Terraform
ruleset owns its whole Cloudflare phase, so existing rules must first be
inventoried and imported before a game-specific rule can be appended safely.
