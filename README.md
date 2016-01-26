# Overview

This is an example of an AWS Lambda function (index.js) that would identify EC2 instances in the specified regions that are not tagged and will terminate them.

## Required IAM Permissions

logs:CreateLogGroup
logs:CreateLogStream
logs:PutLogEvents
ec2:DescribeInstances
ec2:TerminateInstances
