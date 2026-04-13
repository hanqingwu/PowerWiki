rm powerwiki-powerwiki.tar
docker build -t powerwiki-powerwiki -f Dockerfile  .
docker save powerwiki-powerwiki -o powerwiki-powerwiki.tar
