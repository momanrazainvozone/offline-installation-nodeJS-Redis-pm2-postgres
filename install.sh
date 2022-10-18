#!/usr/bin/env bash
echo "** Installing Project dependency, It may take some time. **" &&
echo "** Installing Node JS**" &&
sudo cp -r node/{bin,include,lib,share} /usr/
export PATH=/usr/node-v16.18.0-linux-x64/bin:$PATH
echo "**  installing pm2 **" &&
sudo npm i ./pm2-master -g &&
echo "** ======================================  Preparing postgress SQL Depenency  ====================================== **" &&

cd postgresql &&
./configure &&
sudo make &&
echo "** ======================================  Installing postgress SQL Server ====================================== **" &&

sudo su -c  'make install' root && 
echo "** ======================================  Adding user postgres ====================================== **" &&
sudo su -c  'adduser postgres' root && 
echo "** ======================================  Clear Data ====================================== **" &&

sudo su -c 'mkdir /usr/local/pgsql/data' root && 
sudo su -c  'chown postgres /usr/local/pgsql/data' root && 
echo "** ======================================  Finalizing ====================================== **" &&

sudo su -c '/usr/local/pgsql/bin/initdb -D /usr/local/pgsql/data' postgres && 
sudo su -c '/usr/local/pgsql/bin/pg_ctl -D /usr/local/pgsql/data -l logfile start' postgres  && 
sudo su -c '/usr/local/pgsql/bin/createdb test' postgres &&
exit && exit && export PATH=/usr/local/pgsql/bin:$PATH &&
cd .. &&
echo "** Installing redis server **" &&
cd redis-stable &&
make &&
sudo install make
