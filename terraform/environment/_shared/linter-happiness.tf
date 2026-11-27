# _shared isn't a complete configuration: test and prod symlink its other
# files and set these locals in their own environment.tf. This file isn't
# symlinked. It lets editors and scanners (such as Trivy) resolve the
# references when they read _shared on its own.
locals {
  environment = "none"
  domain      = "example.com"
  host        = "none"
}
