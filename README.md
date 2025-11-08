# github rankings

rank github developers by location, contributions and followers across 138 countries.

## features

- automatic data collection via github actions
- serverless deployment on vercel
- modern web interface with pure black theme
- rankings by followers, public contributions, and total contributions
- 138 countries tracked

## quick start

### local development

1. install dependencies:
```bash
pip install -r requirements.txt
```

2. set github token:
```bash
export GITHUB_TOKEN=your_token_here
```

3. collect data:
```bash
python scripts/collect.py
```

4. view results in `data/` directory

### deployment

#### vercel

1. connect your github repository to vercel
2. add `GITHUB_TOKEN` secret in repository settings
3. deploy will happen automatically

#### github actions

data collection runs automatically every sunday via github actions. configure `GITHUB_TOKEN` secret in repository settings.

## structure

```
├── api/              serverless functions
├── public/           web interface
├── scripts/          data collection
├── data/             generated rankings
└── config.json       configuration
```

## configuration

edit `config.json` to customize:
- countries to track
- minimum follower requirements
- maximum users per location
- api request delay

## theme

pure black (#000000) with dark orange (#ff6600) accents
