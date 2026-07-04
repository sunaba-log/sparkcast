resource "null_resource" "docker_build" {
  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    command = <<EOF
        set -e
        cd ${var.docker_context_path}
        ${var.docker_build_command}
        if [ -n "${var.docker_build_result_image_name}" ]; then
          docker tag ${var.docker_build_result_image_name} ${local.docker_image_latest}
        fi
    EOF
  }
}

resource "null_resource" "docker_push" {
  triggers = {
    digest = data.external.docker_image_digest.result.digest
  }

  provisioner "local-exec" {
    command = <<EOF
        set -e
        # CI(WIF) は access token、ローカルは SA キー(_json_key) で AR にログインする。
        if [ -n "$GOOGLE_OAUTH_ACCESS_TOKEN" ]; then
          echo "$GOOGLE_OAUTH_ACCESS_TOKEN" | docker login -u oauth2accesstoken --password-stdin https://${var.region}-docker.pkg.dev
        else
          cat "$GOOGLE_APPLICATION_CREDENTIALS" | docker login -u _json_key --password-stdin https://${var.region}-docker.pkg.dev
        fi
        docker tag ${local.docker_image_latest} ${local.docker_image}
        docker push ${local.docker_image}
    EOF
  }

  depends_on = [
    google_artifact_registry_repository.main,
    null_resource.docker_build,
  ]
}
