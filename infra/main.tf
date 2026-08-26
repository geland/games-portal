terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.23"
    }
  }
}

# Authentication comes from CLOUDFLARE_API_TOKEN. Never put the token in a
# tfvars file or commit it to this repository.
provider "cloudflare" {}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns gregeland.com"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for gregeland.com"
  type        = string
}

resource "cloudflare_r2_bucket" "game_releases" {
  account_id    = var.cloudflare_account_id
  name          = "gregeland-games-releases"
  location      = "wnam"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_managed_domain" "game_releases" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.game_releases.name
  enabled     = false
}

resource "cloudflare_r2_custom_domain" "game_releases" {
  account_id  = var.cloudflare_account_id
  zone_id     = var.cloudflare_zone_id
  bucket_name = cloudflare_r2_bucket.game_releases.name
  domain      = "play.games.gregeland.com"
  enabled     = true
  min_tls     = "1.2"
}

# A zone cache rule configured outside this Terraform state caches successful
# play.games.gregeland.com responses while explicitly bypassing 300-599. Do not
# add or import a cloudflare_ruleset here without first inventorying the entire
# existing phase ruleset: that resource owns the phase and an incomplete apply
# could remove unrelated rules. Release preflight requires a missing probe to
# remain 404 with DYNAMIC/BYPASS and no Age so a cached miss cannot hide a newly
# uploaded immutable release.

resource "cloudflare_workers_custom_domain" "catalog" {
  account_id = var.cloudflare_account_id
  hostname   = "games.gregeland.com"
  service    = "gregeland-games"
  zone_id    = var.cloudflare_zone_id
  zone_name  = "gregeland.com"

  lifecycle {
    prevent_destroy = true
  }
}

output "release_bucket_name" {
  value = cloudflare_r2_bucket.game_releases.name
}

output "release_origin" {
  value = "https://${cloudflare_r2_custom_domain.game_releases.domain}"
}
