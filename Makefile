.PHONY: terraform-init  # initialize terraform (remote state)
.PHONY: terraform-upgrade  # initialize terraform with provider upgrades
.PHONY: terraform-format  # format terraform code
.PHONY: terraform-validate  # check formatting and validate terraform code
.PHONY: terraform-all  # format and validate terraform code
.PHONY: terraform-plan  # show planned infrastructure changes
.PHONY: terraform-apply  # apply infrastructure changes
.PHONY: terraform-output  # show terraform outputs

SHELL := /bin/bash

TERRAFORM_DIR := infra
TERRAFORM := terraform -chdir=$(TERRAFORM_DIR)

terraform-init:
	$(TERRAFORM) init

terraform-upgrade:
	$(TERRAFORM) init -upgrade

terraform-format:
	$(TERRAFORM) fmt -recursive

terraform-validate: terraform-init
	$(TERRAFORM) fmt -check -recursive -diff
	$(TERRAFORM) validate

terraform-all: terraform-format terraform-validate

terraform-plan: terraform-init
	$(TERRAFORM) plan

terraform-apply: terraform-init
	$(TERRAFORM) apply

terraform-output:
	$(TERRAFORM) output
