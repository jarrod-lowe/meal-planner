# The test environment, deployed by `make deploy-test`. Everything else is
# symlinked from ../_shared.
locals {
  environment = "test"
  domain      = "wildsea.lowe.kiwi"
  host        = "meal-planner-test"
}
