# aliyun-fc-nginx-log-processor

Serverless log processor for processing NGINX log collected by fluentd from docker containers

## Trigger function param setting

```json
{
  "source": {
    "endpoint": "https://cn-hangzhou-intranet.log.aliyuncs.com"
  },
  "target": {
    "endpoint": "https://cn-hangzhou-intranet.log.aliyuncs.com",
    "errorLogStore": "error log store name, optional",
    "logStore": "target log store name",
    "project": "project name"
  },
  "logLevel": "error",
}
```