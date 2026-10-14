output "state_bucket" {
  description = "The bucket every Terraform state in the account lives in."
  value       = aws_s3_bucket.state.bucket
}

output "state_bucket_arn" {
  description = "Its ARN."
  value       = aws_s3_bucket.state.arn
}
