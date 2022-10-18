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
sudo su -c root make install && 
echo "** ======================================  Adding user postgres ====================================== **" &&
sudo su -c root adduser postgres && 
sudo su -c root rm -rf  /usr/local/pgsql/data &&
echo "** ======================================  Clear Data ====================================== **" &&
sudo su -c root mkdir /usr/local/pgsql/data && 
sudo su -c root chown postgres /usr/local/pgsql/data && 
echo "** ======================================  Chnage Permissions ====================================== **" &&
echo "** ======================================  Finalizing ====================================== **" &&
sudo su -c postgres /usr/local/pgsql/bin/initdb -D /usr/local/pgsql/data  && 

sudo su -c /usr/local/pgsql/bin/initdb -D /usr/local/pgsql/data && 
sudo su -c /usr/local/pgsql/bin/pg_ctl -D /u02/pgsql/data -l logfile start  && 
sudo su -c /usr/local/pgsql/bin/createdb test &&
exit && exit && export PATH=/usr/local/pgsql/bin:$PATH &&
cd .. &&
echo "** Installing redis server **" &&
cd redis-stable &&
make &&
sudo install make
