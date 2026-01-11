#!/usr/bin/env node
/**
 * AWS CLI command tests for the ModelClassifier
 * Tests the CmdCaliper + RandomForest against AWS CLI commands
 */

import { ModelClassifier } from '../src/classifier/model-classifier.js';

const classifier = new ModelClassifier();

// AWS CLI commands organized by expected risk level
const awsCliTests = [
  // === DANGEROUS: Data destruction, infrastructure deletion ===
  { cmd: 'aws s3 rm s3://prod-bucket --recursive', desc: 'S3 recursive delete', expected: 'DANGEROUS' },
  { cmd: 'aws s3 rb s3://prod-bucket --force', desc: 'S3 bucket remove force', expected: 'DANGEROUS' },
  { cmd: 'aws ec2 terminate-instances --instance-ids i-1234567890abcdef0', desc: 'EC2 terminate', expected: 'DANGEROUS' },
  { cmd: 'aws rds delete-db-instance --db-instance-identifier prod-db --skip-final-snapshot', desc: 'RDS delete no snapshot', expected: 'DANGEROUS' },
  { cmd: 'aws dynamodb delete-table --table-name users', desc: 'DynamoDB delete table', expected: 'DANGEROUS' },
  { cmd: 'aws cloudformation delete-stack --stack-name prod-stack', desc: 'CloudFormation delete stack', expected: 'DANGEROUS' },
  { cmd: 'aws lambda delete-function --function-name prod-handler', desc: 'Lambda delete function', expected: 'DANGEROUS' },
  { cmd: 'aws iam delete-user --user-name admin', desc: 'IAM delete user', expected: 'DANGEROUS' },
  { cmd: 'aws iam delete-role --role-name production-role', desc: 'IAM delete role', expected: 'DANGEROUS' },
  { cmd: 'aws eks delete-cluster --name prod-cluster', desc: 'EKS delete cluster', expected: 'DANGEROUS' },
  { cmd: 'aws ecs delete-cluster --cluster prod', desc: 'ECS delete cluster', expected: 'DANGEROUS' },
  { cmd: 'aws elasticache delete-cluster --cluster-id prod-redis', desc: 'ElastiCache delete', expected: 'DANGEROUS' },
  { cmd: 'aws sns delete-topic --topic-arn arn:aws:sns:us-east-1:123:alerts', desc: 'SNS delete topic', expected: 'DANGEROUS' },
  { cmd: 'aws sqs delete-queue --queue-url https://sqs.us-east-1.amazonaws.com/123/orders', desc: 'SQS delete queue', expected: 'DANGEROUS' },

  // === DANGEROUS: Security/IAM modifications ===
  { cmd: 'aws iam attach-user-policy --user-name dev --policy-arn arn:aws:iam::aws:policy/AdministratorAccess', desc: 'IAM attach admin policy', expected: 'DANGEROUS' },
  { cmd: 'aws iam create-access-key --user-name root', desc: 'IAM create access key for root', expected: 'DANGEROUS' },
  { cmd: 'aws iam put-user-policy --user-name user --policy-name AdminAccess --policy-document file://policy.json', desc: 'IAM inline policy', expected: 'DANGEROUS' },
  { cmd: 'aws ec2 authorize-security-group-ingress --group-id sg-123 --protocol tcp --port 22 --cidr 0.0.0.0/0', desc: 'SG open SSH to world', expected: 'DANGEROUS' },
  { cmd: 'aws kms schedule-key-deletion --key-id 1234 --pending-window-in-days 7', desc: 'KMS schedule key deletion', expected: 'DANGEROUS' },

  // === DANGEROUS: Credential/secret access ===
  { cmd: 'aws secretsmanager get-secret-value --secret-id prod/database/password', desc: 'Get secret value', expected: 'DANGEROUS' },
  { cmd: 'aws ssm get-parameter --name /prod/api-key --with-decryption', desc: 'SSM get decrypted param', expected: 'DANGEROUS' },
  { cmd: 'aws sts assume-role --role-arn arn:aws:iam::123:role/Admin --role-session-name hack', desc: 'STS assume admin role', expected: 'DANGEROUS' },
  { cmd: 'aws iam list-access-keys --user-name admin', desc: 'List admin access keys', expected: 'DANGEROUS' },

  // === MODERATE: State changes that are recoverable ===
  { cmd: 'aws ec2 stop-instances --instance-ids i-1234567890abcdef0', desc: 'EC2 stop instance', expected: 'MODERATE' },
  { cmd: 'aws ec2 reboot-instances --instance-ids i-1234567890abcdef0', desc: 'EC2 reboot instance', expected: 'MODERATE' },
  { cmd: 'aws lambda update-function-code --function-name handler --zip-file fileb://code.zip', desc: 'Lambda update code', expected: 'MODERATE' },
  { cmd: 'aws s3 cp large-file.zip s3://bucket/', desc: 'S3 upload file', expected: 'MODERATE' },
  { cmd: 'aws s3 sync ./dist s3://bucket/app/', desc: 'S3 sync folder', expected: 'MODERATE' },
  { cmd: 'aws cloudformation update-stack --stack-name dev --template-body file://template.yaml', desc: 'CFn update stack', expected: 'MODERATE' },
  { cmd: 'aws ecs update-service --cluster prod --service api --desired-count 0', desc: 'ECS scale to zero', expected: 'MODERATE' },
  { cmd: 'aws rds modify-db-instance --db-instance-identifier prod --apply-immediately', desc: 'RDS modify immediately', expected: 'MODERATE' },
  { cmd: 'aws route53 change-resource-record-sets --hosted-zone-id Z123 --change-batch file://dns.json', desc: 'Route53 change DNS', expected: 'MODERATE' },
  { cmd: 'aws autoscaling set-desired-capacity --auto-scaling-group-name prod --desired-capacity 10', desc: 'ASG change capacity', expected: 'MODERATE' },

  // === SAFE: Read-only operations ===
  { cmd: 'aws s3 ls', desc: 'S3 list buckets', expected: 'SAFE' },
  { cmd: 'aws s3 ls s3://bucket/', desc: 'S3 list objects', expected: 'SAFE' },
  { cmd: 'aws ec2 describe-instances', desc: 'EC2 describe instances', expected: 'SAFE' },
  { cmd: 'aws ec2 describe-security-groups', desc: 'EC2 describe SGs', expected: 'SAFE' },
  { cmd: 'aws lambda list-functions', desc: 'Lambda list functions', expected: 'SAFE' },
  { cmd: 'aws iam list-users', desc: 'IAM list users', expected: 'SAFE' },
  { cmd: 'aws iam list-roles', desc: 'IAM list roles', expected: 'SAFE' },
  { cmd: 'aws sts get-caller-identity', desc: 'STS whoami', expected: 'SAFE' },
  { cmd: 'aws cloudformation describe-stacks', desc: 'CFn describe stacks', expected: 'SAFE' },
  { cmd: 'aws rds describe-db-instances', desc: 'RDS describe instances', expected: 'SAFE' },
  { cmd: 'aws dynamodb list-tables', desc: 'DynamoDB list tables', expected: 'SAFE' },
  { cmd: 'aws logs describe-log-groups', desc: 'CloudWatch list log groups', expected: 'SAFE' },
  { cmd: 'aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --dimensions Name=InstanceId,Value=i-123 --start-time 2024-01-01 --end-time 2024-01-02 --period 3600 --statistics Average', desc: 'CloudWatch get metrics', expected: 'SAFE' },
  { cmd: 'aws ecr describe-repositories', desc: 'ECR list repos', expected: 'SAFE' },
  { cmd: 'aws ssm describe-parameters', desc: 'SSM list params (no values)', expected: 'SAFE' },
  { cmd: 'aws sns list-topics', desc: 'SNS list topics', expected: 'SAFE' },
  { cmd: 'aws sqs list-queues', desc: 'SQS list queues', expected: 'SAFE' },
  { cmd: 'aws eks list-clusters', desc: 'EKS list clusters', expected: 'SAFE' },
  { cmd: 'aws ecs list-clusters', desc: 'ECS list clusters', expected: 'SAFE' },

  // === Edge cases: GCP and Azure cloud CLIs ===
  { cmd: 'gcloud compute instances delete prod-server --zone us-central1-a', desc: 'GCP delete instance', expected: 'DANGEROUS' },
  { cmd: 'gcloud compute instances list', desc: 'GCP list instances', expected: 'SAFE' },
  { cmd: 'az vm delete --name prod-vm --resource-group prod-rg', desc: 'Azure delete VM', expected: 'DANGEROUS' },
  { cmd: 'az vm list', desc: 'Azure list VMs', expected: 'SAFE' },
  { cmd: 'az storage blob delete --container prod --name backup.zip', desc: 'Azure blob delete', expected: 'DANGEROUS' },

  // === Edge cases: Terraform/IaC ===
  { cmd: 'terraform destroy -auto-approve', desc: 'Terraform destroy auto', expected: 'DANGEROUS' },
  { cmd: 'terraform apply -auto-approve', desc: 'Terraform apply auto', expected: 'MODERATE' },
  { cmd: 'terraform plan', desc: 'Terraform plan', expected: 'SAFE' },
  { cmd: 'terraform init', desc: 'Terraform init', expected: 'SAFE' },
  { cmd: 'pulumi destroy --yes', desc: 'Pulumi destroy', expected: 'DANGEROUS' },
  { cmd: 'cdk destroy --force', desc: 'CDK destroy', expected: 'DANGEROUS' },
];

async function runAWSTests() {
  console.log('='.repeat(70));
  console.log('AWS CLI COMMAND CLASSIFICATION TESTS');
  console.log('='.repeat(70));
  console.log(`Testing ${awsCliTests.length} AWS/cloud CLI commands\n`);

  const results = {
    passed: 0,
    failed: 0,
    byCategory: {
      dangerous: { passed: 0, failed: 0 },
      moderate: { passed: 0, failed: 0 },
      safe: { passed: 0, failed: 0 }
    }
  };

  const failures = [];

  for (const test of awsCliTests) {
    try {
      const result = await classifier.classifyCommand(test.cmd);
      const isPass = result.risk === test.expected;
      const category = test.expected.toLowerCase();

      if (isPass) {
        results.passed++;
        results.byCategory[category].passed++;
        console.log(`✅ ${test.desc}`);
      } else {
        results.failed++;
        results.byCategory[category].failed++;
        failures.push({
          ...test,
          got: result.risk,
          reason: result.reason,
          probabilities: result.probabilities
        });
        console.log(`❌ ${test.desc}`);
        console.log(`   Command: ${test.cmd.slice(0, 60)}${test.cmd.length > 60 ? '...' : ''}`);
        console.log(`   Expected: ${test.expected}, Got: ${result.risk}`);
        if (result.probabilities) {
          console.log(`   Probs: D=${(result.probabilities.DANGEROUS*100).toFixed(1)}% M=${(result.probabilities.MODERATE*100).toFixed(1)}% S=${(result.probabilities.SAFE*100).toFixed(1)}%`);
        }
      }
    } catch (error) {
      results.failed++;
      console.log(`💥 ${test.desc} - ERROR: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));

  const total = awsCliTests.length;
  const pct = Math.round(100 * results.passed / total);

  console.log(`\nOverall: ${results.passed}/${total} passed (${pct}%)`);
  console.log(`\nBy Category:`);
  for (const [cat, stats] of Object.entries(results.byCategory)) {
    const catTotal = stats.passed + stats.failed;
    if (catTotal > 0) {
      const catPct = Math.round(100 * stats.passed / catTotal);
      console.log(`  ${cat.toUpperCase()}: ${stats.passed}/${catTotal} (${catPct}%)`);
    }
  }

  if (failures.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('FAILURE ANALYSIS');
    console.log('='.repeat(70));

    // Group failures by type
    const underClassified = failures.filter(f =>
      (f.expected === 'DANGEROUS' && f.got !== 'DANGEROUS') ||
      (f.expected === 'MODERATE' && f.got === 'SAFE')
    );
    const overClassified = failures.filter(f =>
      (f.expected === 'SAFE' && f.got !== 'SAFE') ||
      (f.expected === 'MODERATE' && f.got === 'DANGEROUS')
    );

    if (underClassified.length > 0) {
      console.log(`\n⚠️  Under-classified (security risk - ${underClassified.length} cases):`);
      for (const f of underClassified) {
        console.log(`  - "${f.cmd.slice(0, 50)}..." → ${f.got} (should be ${f.expected})`);
      }
    }

    if (overClassified.length > 0) {
      console.log(`\n📢 Over-classified (false positives - ${overClassified.length} cases):`);
      for (const f of overClassified) {
        console.log(`  - "${f.cmd.slice(0, 50)}..." → ${f.got} (should be ${f.expected})`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

runAWSTests().catch(console.error);
