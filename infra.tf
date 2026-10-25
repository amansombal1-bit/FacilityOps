terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}
variable "project_id" { type = string }
variable "region" { default = "asia-south1" }
variable "environment" { default = "staging" }
provider "google" { project = var.project_id
region = var.region }
locals { apis = toset(["run.googleapis.com","sqladmin.googleapis.com","secretmanager.googleapis.com","cloudscheduler.googleapis.com","artifactregistry.googleapis.com","cloudbuild.googleapis.com","gmail.googleapis.com","drive.googleapis.com"]) }
resource "google_project_service" "api" { for_each = local.apis
service = each.value
disable_on_destroy = false }
resource "google_artifact_registry_repository" "app" { location = var.region
repository_id = "facilityops"
format = "DOCKER"
depends_on = [google_project_service.api] }
resource "google_service_account" "runtime" { account_id = "facilityops-runtime"
display_name = "FacilityOps application and worker" }
resource "google_service_account" "scheduler" { account_id = "facilityops-scheduler"
display_name = "FacilityOps scheduler invoker" }
resource "google_project_iam_member" "sql_client" { project = var.project_id
role = "roles/cloudsql.client"
member = "serviceAccount:${google_service_account.runtime.email}" }
resource "google_sql_database_instance" "db" {
  name = "facilityops-${var.environment}"
  region = var.region
  database_version = "POSTGRES_16"
  deletion_protection = true
  depends_on = [google_project_service.api]
  settings {
    tier = "db-custom-1-3840"
    availability_type = "REGIONAL"
    disk_type = "PD_SSD"
    disk_autoresize = true
    ip_configuration { ipv4_enabled = true }
    backup_configuration {
      enabled = true
      point_in_time_recovery_enabled = true
      start_time = "20:00"
      transaction_log_retention_days = 7
      backup_retention_settings { retained_backups = 14 }
    }
  }
}
resource "google_sql_database" "app" { name = "facilityops"
instance = google_sql_database_instance.db.name }
locals { secrets = toset(["fo-database-url","fo-otp-secret","fo-job-secret","fo-google-client-id","fo-google-client-secret","fo-google-refresh-token","fo-google-sender"]) }
resource "google_secret_manager_secret" "app" {
  for_each = local.secrets
  secret_id = each.value
  replication { auto {} }
  depends_on = [google_project_service.api]
}
resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = google_secret_manager_secret.app
  secret_id = each.value.secret_id
  role = "roles/secretmanager.secretAccessor"
  member = "serviceAccount:${google_service_account.runtime.email}"
}
output "sql_connection" { value = google_sql_database_instance.db.connection_name }
output "runtime_sa" { value = google_service_account.runtime.email }
output "scheduler_sa" { value = google_service_account.scheduler.email }
