output "repository_id" {
  description = "artifact registry repository id"
  value       = google_artifact_registry_repository.main.repository_id
}

output "docker_image_name" {
  description = "full name of the built and pushed docker image"
  value       = local.docker_image

  # The tag is computed before publication; consumers must wait for the push.
  depends_on = [null_resource.docker_push]
}

output "docker_image_digest" {
  description = "digest of the built docker image"
  value       = data.external.docker_image_digest.result.digest
}
