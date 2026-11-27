# The prod environment, deployed by GitHub Actions on merge to main.
# Everything else is symlinked from ../_shared.
locals {
  environment = "prod"
  domain      = "wildsea.lowe.kiwi"
  host        = "meal-planner"
}
