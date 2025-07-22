BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS "clients" (
  "id"             varchar(255) PRIMARY KEY,
  "name"           varchar(255) NOT NULL,
  "email"          varchar(255) NOT NULL,
  "phone"          varchar(255) NOT NULL,
  "address"        varchar(255) NOT NULL,
  "postalCode"     varchar(255),
  "companyId"      varchar(255),
  "pib"            varchar(255),
  "contractNumber" varchar(255),
  "paymentTerm"    varchar(255),
  "amountInWords"  varchar(255)
);

CREATE TABLE IF NOT EXISTS "executors" (
  "id"      varchar(255) PRIMARY KEY,
  "name"    varchar(255) NOT NULL,
  "email"   varchar(255),
  "phone"   varchar(255),
  "address" varchar(255)
);

CREATE TABLE IF NOT EXISTS "invoices" (
  "id"                 varchar(255) PRIMARY KEY,
  "number"             varchar(255) NOT NULL,
  "clientId"           varchar(255) NOT NULL,
  "date"               date         NOT NULL,
  "description"        varchar(255),
  "quantity"           integer,
  "price"              double precision,
  "unit"               varchar(255),
  "totalNoVat"         double precision,
  "vat"                double precision,
  "total"              double precision,
  "amountInWords"      varchar(255),
  "contractNumber"     varchar(255),
  "paymentTerm"        varchar(255),
  "paymentDate"        date,
  "paymentOrderNumber" varchar(255)
);

CREATE TABLE IF NOT EXISTS "kufs" (
  "id"           varchar(255) PRIMARY KEY,
  "brojKuf"      varchar(255) NOT NULL,
  "datumKuf"     date         NOT NULL,
  "datumPrijema" date,
  "imeKomitenta" varchar(255) NOT NULL,
  "idKomitenta"  varchar(255),
  "iznos"        double precision NOT NULL,
  "placeno"      boolean           DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "plans" (
  "id"         varchar(255) PRIMARY KEY,
  "clientId"   varchar(255) NOT NULL,
  "executorId" varchar(255) NOT NULL,
  "service"    varchar(255) NOT NULL,
  "date"       date         NOT NULL,
  "recurrence" varchar(255),
  "done"       boolean      DEFAULT FALSE,
  "iznos"      double precision DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "sanitarne" (
  "id"           varchar(255) PRIMARY KEY,
  "clientId"     varchar(255) NOT NULL,
  "employeeName" varchar(255) NOT NULL,
  "dateIssued"   date         NOT NULL,
  "expiryDate"   date         NOT NULL
);

INSERT INTO "clients" VALUES
('49e54bac-6f6f-4d2d-97db-14dbffb69dec',
 'ASCINICA KUDUZ d.o.o. Sarajevo',
 'kuduz@gmail.com',
 '033333',
 'Zagrebacka bb.',
 '71000 Sarajevo',
 '4202879690001',
 '202879690001',
 '03-02/25',
 '15',
 'petesetosam KM i 50/100'
);

INSERT INTO "executors" VALUES
('be747b42-ced4-4c24-8224-7f8ea801269b',
 'Amina Smajevic',
 'amina@s-consulting.ba',
 '061/335-459',
 '71000 Sarajevo'
);

INSERT INTO "invoices" VALUES
('eb5996fc-0a86-4713-b56c-a80e3df0cab4',
 '223/25',
 '49e54bac-6f6f-4d2d-97db-14dbffb69dec',
 '2025-07-14',
 'Usluge savjetovanja',
 1,
 50.0,
 'pausal',
 50.0,
 8.5,
 58.5,
 'petesetosam KM i 50/100',
 '03-02/25',
 '15',
 NULL,
 ''
);

INSERT INTO "invoices" VALUES
('fa5adda4-c1bb-4bbc-9292-5bbbc20b3c05',
 '224/25',
 '49e54bac-6f6f-4d2d-97db-14dbffb69dec',
 '2025-07-15',
 'Usluge savjetovanja',
 1,
 50.0,
 'pausal',
 50.0,
 8.5,
 58.5,
 'petesetosam KM i 50/100',
 '03-02/25',
 '15',
 NULL,
 ''
);

INSERT INTO "plans" VALUES
('e5c31e78-1a69-4b50-a241-9a7a4d58ce18',
 '49e54bac-6f6f-4d2d-97db-14dbffb69dec',
 'be747b42-ced4-4c24-8224-7f8ea801269b',
 'Monitoring',
 '2025-07-15',
 '1',
 FALSE,
 50.0
);

COMMIT;
