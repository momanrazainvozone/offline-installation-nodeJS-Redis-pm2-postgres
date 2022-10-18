#!/usr/bin/env bash
echo "** Installing Project dependency, It may take some time. **" &&
echo "** Installing Node JS**" &&
sudo cp -r node/{bin,include,lib,share} /usr/
export PATH=/usr/node-v16.18.0-linux-x64/bin:$PATH
echo "**  installing pm2 **" &&
sudo npm i ./pm2-master -g &&
echo "** Installing postgress SQL Server **" &&
cd postgresql &&
./configure &&
make &&
su && make install && 
adduser postgres && 
mkdir /usr/local/pgsql/data && 
chown postgres /usr/local/pgsql/data && 
su - postgres && 
/usr/local/pgsql/bin/initdb -D /usr/local/pgsql/data && 
/usr/local/pgsql/bin/pg_ctl -D /u02/pgsql/data -l logfile start  && 
/usr/local/pgsql/bin/createdb test &&
exit && exit && export PATH=/usr/local/pgsql/bin:$PATH &&
cd .. &&
echo "** Installing redis server **" &&
cd redis-stable &&
make &&
sudo install make
